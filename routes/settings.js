"use strict";
// routes/settings.js
// 系统设置路由 (settings 化, 读=admin/settings.r, 写=settings.w)
//   GET  /api/settings
//   GET  /api/settings/:key
//   PUT  /api/settings/:key
//   POST /api/settings/test-feishu
//   GET  /api/settings-all   (兼容老 client, 限 admin)
// Author: 三狗子 | Date: 2026-06-24

const { requirePermission } = require('../middleware/auth');
const systemSettings = require('../services/systemSettings');
const { feishuNotify } = require('../services/feishuNotify');
const audit = require('../app/audit');

function register(app, db) {
  systemSettings.setDb(db);
  app.get('/api/settings',     requirePermission('settings:read', 'settings:write'), (req, res) => { const items = systemSettings.getAll(); res.json({ items }); });
  app.get('/api/settings/:key', requirePermission('settings:read', 'settings:write'), (req, res) => { const r = systemSettings.getOne(req.params.key); if (!r) return res.status(404).json({ error: 'setting not found' }); res.json(r); });
  app.put('/api/settings/:key', requirePermission('settings:write'), (req, res) => {
    const before = systemSettings.getOne(req.params.key);
    const v = req.body && req.body.value;
    const result = systemSettings.setOne(req.params.key, v, req.user && req.user.uid, {
      clearSecret: Boolean(req.body && req.body.clear_secret),
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    const after = result.kept
      ? { value: '(unchanged)' }
      : { value: before && before.is_secret ? '***' : v };
    audit.record(db, req, {
      action: 'settings.update',
      resource_type: 'system_setting',
      resource_id: req.params.key,
      before: before ? { value: before.is_secret ? '***' : before.value, value_type: before.value_type } : null,
      after,
      diff_summary: `更新参数 ${req.params.key}`,
    });
    res.json(result);
  });
  app.post('/api/settings/test-feishu', requirePermission('feishu:notify'), async (req, res) => {
    const title = (req.body && req.body.title) || '🔔 MES 测试消息';
    const content = (req.body && req.body.content) || '这是一条来自 systemSettings.test-feishu 的测试消息。';
    try {
      const r = await feishuNotify(title, content);
      audit.record(db, req, {
        action: 'settings.feishu.test',
        resource_type: 'system_setting',
        resource_id: 'feishu_webhook_token',
        after: { ok: Boolean(r.ok), skipped: Boolean(r.skipped), title },
        diff_summary: '发送飞书测试消息',
        status: r.ok ? 'success' : 'failed',
        error: r.ok ? null : (r.error || 'send failed'),
      });
      res.json(r);
    } catch (error) {
      audit.record(db, req, {
        action: 'settings.feishu.test',
        resource_type: 'system_setting',
        resource_id: 'feishu_webhook_token',
        diff_summary: '发送飞书测试消息',
        status: 'failed',
        error: error.message,
      });
      res.status(500).json({ ok: false, error: error.message });
    }
  });
  app.get('/api/settings-all', requirePermission('settings:read', 'settings:write'), (req, res) => { res.json({ items: systemSettings.getAll() }); });
}

module.exports = { register };