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

function register(app) {
  app.get('/api/settings',     requirePermission('settings:read', 'settings:write'), (req, res) => { const items = systemSettings.getAll(); res.json({ items }); });
  app.get('/api/settings/:key', requirePermission('settings:read', 'settings:write'), (req, res) => { const r = systemSettings.getOne(req.params.key); if (!r) return res.status(404).json({ error: 'setting not found' }); res.json(r); });
  app.put('/api/settings/:key', requirePermission('settings:write'), (req, res) => { const v = req.body && req.body.value; const result = systemSettings.setOne(req.params.key, v, req.user && req.user.uid); if (!result.ok) return res.status(404).json(result); res.json(result); });
  app.post('/api/settings/test-feishu', requirePermission('feishu:notify'), async (req, res) => {
    const title = (req.body && req.body.title) || '🔔 MES 测试消息';
    const content = (req.body && req.body.content) || '这是一条来自 systemSettings.test-feishu 的测试消息。';
    const r = await feishuNotify(title, content);
    res.json(r);
  });
  app.get('/api/settings-all', requirePermission('settings:read', 'settings:write'), (req, res) => { res.json({ items: systemSettings.getAll() }); });
}

module.exports = { register };