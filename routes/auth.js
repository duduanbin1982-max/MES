"use strict";
// routes/auth.js
// 鉴权路由: 登录/我/登出 + 角色守卫
//   POST /api/auth/login
//   GET  /api/auth/me
//   POST /api/auth/logout
// Author: 三狗子 | Date: 2026-06-25

const bcrypt = require('bcryptjs');
const { makeToken, loginLimiter, getRolePermissions } = require('../middleware/auth');

function register(app, db) {
  const { get, run } = require('./_helpers')(db);

  app.post('/api/auth/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名/密码必填' });
    if (typeof username !== 'string' || username.length > 64) return res.status(400).json({ error: '参数无效' });
    const user = get('SELECT u.*, r.role_code, r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.username = ? AND u.is_active = 1', username);
    if (!user) return res.status(401).json({ error: '用户不存在或已禁用' });

    // 密码校验: 优先 bcrypt, 否则 fallback 明文 (demo 兼容), 登录成功后自动升级
    let valid = false;
    if (user.password_hash && user.password_hash.startsWith('$2')) {
      valid = bcrypt.compareSync(password, user.password_hash);
    } else {
      valid = user.password_hash === password;
      if (valid) {
        const hashed = bcrypt.hashSync(password, 10);
        run('UPDATE users SET password_hash = ? WHERE id = ?', [hashed, user.id]);
        console.log('[security] 用户', username, '密码已升级为 bcrypt');
      }
    }
    if (!valid) return res.status(401).json({ error: '密码错误' });

    run("UPDATE users SET last_login = datetime('now') WHERE id = ?", user.id);
    // P0-1: token 塞入 permissions, 前端不需再查
    const permissions = getRolePermissions(user.role_code);
    const token = makeToken(user.id, user.role_code, { permissions, username: user.username });
    res.json({
      token,
      user: {
        id: user.id, username: user.username, full_name: user.full_name,
        role: user.role_code, role_name: user.role_name,
        permissions,  // 显式返回, 前端 store 直接用
      },
    });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    const user = get('SELECT u.id, u.username, u.full_name, u.role_id, r.role_code, r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?', req.user.uid);
    if (!user) return res.status(404).json({ error: 'user not found' });
    // P0-1: 返回当前 token 的 permissions, 前端刷新页面后保持一致
    res.json({
      id: user.id, username: user.username, full_name: user.full_name,
      role: user.role_code, role_name: user.role_name,
      permissions: req.user.permissions || getRolePermissions(user.role_code),
    });
  });

  app.post('/api/auth/logout', (req, res) => res.json({ message: '已登出 (前端清除 token 即可)' }));
}

module.exports = { register };
