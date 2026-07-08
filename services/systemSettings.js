'use strict';
// services/systemSettings.js
// 系统设置 service + 飞书 config 动态读取
// schema 来自 migration 013_settings_and_rbac.sql: system_settings(key, value, value_type, category, description, is_secret, updated_by, updated_at)

let db = null;
let cache = {};        // { key: { value, ts } }
let cacheTs = 0;
const CACHE_TTL_MS = 5000;

function setDb(d) { db = d; cache = {}; cacheTs = 0; }

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
  }));
}

function getOne(key) {
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
  };
}

function setOne(key, rawValue, updatedBy) {
  const exist = db.prepare('SELECT value_type, category, is_secret FROM system_settings WHERE key = ?').get(key);
  if (!exist) return { ok: false, error: 'setting not found: ' + key };
  const str = rawValue == null ? '' : String(rawValue);
  const r = db.prepare('UPDATE system_settings SET value = ?, updated_by = ?, updated_at = datetime(\'now\') WHERE key = ?').run(str, updatedBy || null, key);
  cache = {}; cacheTs = 0;  // invalidate
  return { ok: true, changed: r.changes };
}

// 飞书 config（带 5s cache 避免高频 DB 读）
function getFeishuConfig() {
  const now = Date.now();
  if (cacheTs && (now - cacheTs) < CACHE_TTL_MS) {
    return {
      enabled: cache.feishu_enabled === '1',
      webhook_token: cache.feishu_webhook_token || '',
      timeout_ms: parseInt(cache.feishu_webhook_timeout_ms || '3000', 10),
      receiver_open_id: cache.feishu_receiver_open_id || '',
    };
  }
  const rows = db.prepare('SELECT key, value FROM system_settings WHERE key IN (?, ?, ?, ?)').all(
    'feishu_enabled', 'feishu_webhook_token', 'feishu_webhook_timeout_ms', 'feishu_receiver_open_id'
  );
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
  const r = db.prepare('SELECT value, value_type FROM system_settings WHERE key = ?').get(key);
  if (!r) return defaultVal;
  if (r.value_type === 'boolean') return coerce(r.value, r.value_type);
  return defaultVal;
}

function getNum(key, defaultVal) {
  const r = db.prepare('SELECT value, value_type FROM system_settings WHERE key = ?').get(key);
  if (!r) return defaultVal;
  if (r.value_type === 'number') return coerce(r.value, r.value_type);
  return defaultVal;
}


module.exports = { setDb, getAll, getOne, setOne, getFeishuConfig, getBool, getNum };
