'use strict';
// services/systemSettings.js
// 系统设置 service + 飞书 config 动态读取
// schema 来自 migration 013_settings_and_rbac.sql: system_settings(key, value, value_type, category, description, is_secret, updated_by, updated_at)

let db = null;
let cache = {};        // { key: { value, ts } }
let cacheTs = 0;
const CACHE_TTL_MS = 5000;

// 2026-11-09（参数配置审计）：登记每个参数的消费方/是否真正生效。
// implemented=false 表示当前仅存储，业务尚未读取；UI 必须明确提示，避免“改了没效果”。
const SETTING_META = {
  feishu_enabled: { consumer: "飞书通知", implemented: true, note: "控制 feishuNotify 是否发送" },
  feishu_webhook_token: { consumer: "飞书通知", implemented: true, note: "飞书机器人 webhook（敏感）" },
  feishu_webhook_timeout_ms: { consumer: "飞书通知", implemented: true, note: "webhook 请求超时", min: 100, max: 60000 },
  feishu_receiver_open_id: { consumer: null, implemented: false, note: "仅记录：当前 webhook 群发未按 open_id 定向" },
  default_lead_time_buffer_days: { consumer: "物料计划 MRP", implemented: true, note: "交期缓冲，叠加到 key_components 交期", min: 0, max: 365 },
  cert_expiry_alert_days: { consumer: null, implemented: false, note: "预留：TLS 证书到期告警尚未接入；人员资质临期当前固定 30 天", min: 1, max: 365 },
  shop_timezone: { consumer: null, implemented: false, note: "预留：调度/时区尚未接入" },
  wal_alert_threshold_mb: { consumer: null, implemented: false, note: "预留：WAL 告警尚未接入", min: 1, max: 100000 },
  workday_start_time: { consumer: null, implemented: false, note: "预留：工作日历尚未接入" },
  workday_end_time: { consumer: null, implemented: false, note: "预留：工作日历尚未接入" },
};

function metaOf(key) {
  return SETTING_META[key] || { consumer: null, implemented: false, note: "未登记消费方，暂不保证生效" };
}

function setDb(d) { db = d || null; cache = {}; cacheTs = 0; }

function envFeishuConfig() {
  const token = process.env.FEISHU_WEBHOOK_TOKEN || "";
  const timeout = parseInt(process.env.FEISHU_WEBHOOK_TIMEOUT_MS || "3000", 10);
  return {
    enabled: !!token,
    webhook_token: token,
    timeout_ms: Number.isFinite(timeout) ? timeout : 3000,
    receiver_open_id: "",
  };
}

function coerce(value, valueType) {
  if (value == null) return null;
  switch (valueType) {
    case 'number':  return Number(value);
    case 'boolean': return value === '1' || value === 'true';
    case 'json':    try { return JSON.parse(value); } catch (_e) { return null; }
    default:        return value;
  }
}

function getAll() {
  if (!db) return [];
  const rows = db.prepare('SELECT key, value, value_type, category, description, is_secret, updated_by, updated_at FROM system_settings ORDER BY category, key').all();
  return rows.map(r => ({
    key: r.key,
    value: r.is_secret === 1 ? null : coerce(r.value, r.value_type),  // secret 不回显 value
    value_type: r.value_type,
    category: r.category,
    description: r.description,
    is_secret: r.is_secret === 1,
    is_set: r.is_secret === 1 ? !!r.value : true,
    updated_by: r.updated_by,
    updated_at: r.updated_at,
    ...metaOf(r.key),
  }));
}

function getOne(key) {
  if (!db) return null;
  const r = db.prepare('SELECT key, value, value_type, category, description, is_secret, updated_by, updated_at FROM system_settings WHERE key = ?').get(key);
  if (!r) return null;
  return {
    key: r.key,
    value: r.is_secret === 1 ? null : coerce(r.value, r.value_type),
    value_type: r.value_type,
    category: r.category,
    description: r.description,
    is_secret: r.is_secret === 1,
    is_set: r.is_secret === 1 ? !!r.value : true,
    updated_by: r.updated_by,
    updated_at: r.updated_at,
    ...metaOf(r.key),
  };
}

function normalizeSettingValue(exist, rawValue, { clearSecret = false, meta = {} } = {}) {
  const isSecret = existingIsSecret(exist);
  if (isSecret && !clearSecret && (rawValue === undefined || rawValue === null || String(rawValue) === '')) {
    return { keep: true };
  }
  if (rawValue === undefined || rawValue === null) return { error: 'value 必填', status: 400 };
  switch (exist.value_type) {
    case 'number': {
      const num = Number(rawValue);
      if (!Number.isFinite(num)) return { error: '数值格式不正确', status: 400 };
      if (meta.min != null && num < meta.min) return { error: `数值不能小于 ${meta.min}`, status: 400 };
      if (meta.max != null && num > meta.max) return { error: `数值不能大于 ${meta.max}`, status: 400 };
      return { value: String(num) };
    }
    case 'boolean': {
      const text = String(rawValue).toLowerCase();
      if (['1', 'true'].includes(text)) return { value: '1' };
      if (['0', 'false'].includes(text)) return { value: '0' };
      return { error: '布尔值只能是 true/false 或 1/0', status: 400 };
    }
    case 'json': {
      try {
        const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
        if (parsed && typeof parsed === 'object') return { value: JSON.stringify(parsed) };
        return { value: String(parsed) };
      } catch (_error) { return { error: 'JSON 格式不正确', status: 400 }; }
    }
    default: {
      const text = String(rawValue);
      if (text.length > 10000) return { error: '字符串长度不能超过 10000', status: 400 };
      return { value: text };
    }
  }
}

function existingIsSecret(exist) {
  return exist && (exist.is_secret === 1 || exist.is_secret === true || exist.is_secret === '1');
}

function setOne(key, rawValue, updatedBy, options = {}) {
  if (!db) return { ok: false, status: 503, error: 'settings db not initialized' };
  const exist = db.prepare('SELECT value_type, category, is_secret FROM system_settings WHERE key = ?').get(key);
  if (!exist) return { ok: false, status: 404, error: 'setting not found: ' + key };
  const normalized = normalizeSettingValue(exist, rawValue, { ...options, meta: metaOf(key) });
  if (normalized.error) return { ok: false, status: normalized.status || 400, error: normalized.error };
  if (normalized.keep) return { ok: true, changed: 0, kept: true };
  const r = db.prepare('UPDATE system_settings SET value = ?, updated_by = ?, updated_at = datetime(\'now\') WHERE key = ?').run(normalized.value, updatedBy || null, key);
  cache = {}; cacheTs = 0;  // invalidate
  return { ok: true, changed: r.changes, value_type: exist.value_type };
}

// 飞书 config（带 5s cache 避免高频 DB 读）
function getFeishuConfig() {
  if (!db) return envFeishuConfig();
  const now = Date.now();
  if (cacheTs && (now - cacheTs) < CACHE_TTL_MS) {
    return {
      enabled: cache.feishu_enabled === '1',
      webhook_token: cache.feishu_webhook_token || '',
      timeout_ms: parseInt(cache.feishu_webhook_timeout_ms || '3000', 10),
      receiver_open_id: cache.feishu_receiver_open_id || '',
    };
  }
  let rows;
  try {
    rows = db.prepare('SELECT key, value FROM system_settings WHERE key IN (?, ?, ?, ?)').all(
      'feishu_enabled', 'feishu_webhook_token', 'feishu_webhook_timeout_ms', 'feishu_receiver_open_id'
    );
  } catch (_e) {
    return envFeishuConfig();
  }
  const m = {}; rows.forEach(r => { m[r.key] = r.value; });
  // fallback 到 .env（兼容老的 process.env 写法）
  const enabled = m.feishu_enabled === '1' || (m.feishu_enabled == null && !!process.env.FEISHU_WEBHOOK_TOKEN);
  const token = m.feishu_webhook_token || process.env.FEISHU_WEBHOOK_TOKEN || '';
  const timeout = parseInt(m.feishu_webhook_timeout_ms || process.env.FEISHU_WEBHOOK_TIMEOUT_MS || '3000', 10);
  const receiver = m.feishu_receiver_open_id || '';
  cache = m; cacheTs = now;
  return { enabled, webhook_token: token, timeout_ms: timeout, receiver_open_id: receiver };
}

function getBool(key, defaultVal) {
  if (!db) return defaultVal;
  const r = db.prepare('SELECT value, value_type FROM system_settings WHERE key = ?').get(key);
  if (!r) return defaultVal;
  if (r.value_type === 'boolean') return coerce(r.value, r.value_type);
  return defaultVal;
}

function getNum(key, defaultVal) {
  if (!db) return defaultVal;
  const r = db.prepare('SELECT value, value_type FROM system_settings WHERE key = ?').get(key);
  if (!r) return defaultVal;
  if (r.value_type === 'number') return coerce(r.value, r.value_type);
  return defaultVal;
}


module.exports = { setDb, getAll, getOne, setOne, getFeishuConfig, getBool, getNum, normalizeSettingValue, metaOf, SETTING_META };
