"use strict";
// routes/auth.js
// 鉴权路由
//   POST /api/auth/login       登录, 返回 access_token + refresh_token
//   POST /api/auth/refresh     用 refresh_token 换新 access_token
//   GET  /api/auth/me          当前用户信息 (含 permissions)
//   POST /api/auth/logout      登出 (前端清 token)
// Author: 三狗子 | Date: 2026-06-25 (P0-2 升级 access/refresh 双 token)

const bcrypt = require('bcryptjs');
const { makeToken, loginLimiter, getRolePermissions, handleRefresh } = require('../middleware/auth');
const jwt = require('../app/jwt');
const { ApiError } = require('../app/errors');

const logger = require("../app/logger").createLogger("security");

function register(app, db) {
  const { get, run } = require('./_helpers')(db);

  // 登录: 返回 access + refresh + user
  app.post('/api/auth/login', loginLimiter, (req, res, next) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return next(ApiError.validation('用户名/密码必填'));
      if (typeof username !== 'string' || username.length > 64) return next(ApiError.validation('参数无效'));
      const user = get('SELECT u.*, r.role_code, r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.username = ? AND u.is_active = 1', username);
      if (!user) return next(ApiError.unauthorized('用户不存在或已禁用'));

      // 密码校验: bcrypt 优先, fallback 明文 (demo 兼容)
      let valid = false;
      if (user.password_hash && user.password_hash.startsWith('$2')) {
        valid = bcrypt.compareSync(password, user.password_hash);
      } else {
        valid = user.password_hash === password;
        if (valid) {
          const hashed = bcrypt.hashSync(password, 10);
          run('UPDATE users SET password_hash = ? WHERE id = ?', [hashed, user.id]);
          logger.info('[security] 用户', username, '密码已升级为 bcrypt');
        }
      }
      if (!valid) return next(ApiError.unauthorized('密码错误'));

      run("UPDATE users SET last_login = datetime('now') WHERE id = ?", user.id);
      const permissions = getRolePermissions(user.role_code);
      // P0-2: access + refresh 双 token
      const access  = jwt.signAccess({ sub: user.id, role: user.role_code, permissions, full_name: user.full_name });
      const refresh = jwt.signRefresh(user.id);
      res.json({
        access_token: access.token,
        refresh_token: refresh.token,
        token_type: 'Bearer',
        access_exp: access.exp,
        refresh_exp: refresh.exp,
        user: {
          id: user.id, username: user.username, full_name: user.full_name,
          role: user.role_code, role_name: user.role_name,
          permissions,
        },
      });
    } catch (e) { next(e); }
  });

  // P0-2: refresh — 用 refresh_token 或 access_token 换新 access
  app.post('/api/auth/refresh', (req, res, next) => {
    try {
      const { refresh_token, access_token } = req.body || {};

      // 优先用 refresh_token
      if (refresh_token) {
        const p = jwt.verify(refresh_token);
        if (!p) return next(ApiError.unauthorized('refresh_token 无效或已过期'));
        if (p.typ !== 'refresh') return next(ApiError.unauthorized('token 类型错误 (需 refresh)'));
        if (p.expired) return next(ApiError.unauthorized('refresh_token 已过期'));
        const user = get('SELECT u.id, u.full_name, u.is_active, r.role_code, r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?', p.sub);
        if (!user || !user.is_active) return next(ApiError.unauthorized('用户不存在或已禁用'));
        const permissions = getRolePermissions(user.role_code);
        const access = jwt.signAccess({ sub: user.id, role: user.role_code, permissions, full_name: user.full_name });
        return res.json({
          access_token: access.token,
          token_type: 'Bearer',
          access_exp: access.exp,
          user: { id: user.id, username: null, full_name: user.full_name, role: user.role_code, permissions },
        });
      }

      // Fallback: 用 access_token 刷新 (允许过期但有效签名)
      if (access_token) return handleRefresh(req, res, next);

      return next(ApiError.validation('refresh_token 或 access_token 必填'));
    } catch (e) { next(e); }
  });

  // 当前用户
  app.get('/api/auth/me', (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized('未登录'));
    const user = get('SELECT u.id, u.username, u.full_name, u.role_id, r.role_code, r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?', req.user.uid || req.user.sub);
    if (!user) return next(ApiError.notFound('user not found'));
    res.json({
      id: user.id, username: user.username, full_name: user.full_name,
      role: user.role_code, role_name: user.role_name,
      permissions: req.user.permissions || getRolePermissions(user.role_code),
    });
  });

  // 登出
  app.post('/api/auth/logout', (req, res) => res.json({ message: '已登出 (前端清除 token 即可)' }));
}

module.exports = { register };