// middleware/auth.js
// 2026-06-22 brooks-lint R2 修复：从 server.js 抽出
// 2026-06-23 settings 化：加 requirePermission(permCode) 守卫
//        适配 roles 表 (id, role_code, role_name, permissions JSON, description)
//        permissions 数组支持 'project:read' / 'project:*' / '*' (admin)
// 2026-06-25 P0-1 RBAC 升级:
//   - 启动时一次性缓存所有 role 的 permissions 到内存 (loadRolePermissions)
//   - 登录时把 permissions 塞进 token, req.user.permissions 直接可用
//   - 兜底: 旧 token (无 permissions) 走 DB 查一次, 缓存到 req.user
//   - requirePermission 改用 ApiError (P0-3 统一错误)
//   - 兼容 requireRole (旧业务还在用)

const crypto = require('crypto');
const jwt = require('../app/jwt');
const rateLimit = require('express-rate-limit');
const { ApiError } = require('../app/errors');
const { DEFAULT_ROLE_PERMISSIONS, hasPermission } = require('../app/permissions');

// SECRET 校验在 app/jwt.js 模块加载时已做
const LOGIN_RATE_LIMIT_WINDOW_MS = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || '60000', 10);
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '10', 10);

// P0-1: 内存缓存 role permissions
//   Map<role_code, permissions_array>
const ROLE_PERMS_CACHE = new Map();

function loadRolePermissions(db) {
  if (!db) return;
  try {
    const rows = db.prepare("SELECT role_code, permissions FROM roles").all();
    ROLE_PERMS_CACHE.clear();
    for (const r of rows) {
      let perms = [];
      try { perms = JSON.parse(r.permissions || '[]'); } catch (_e) { perms = []; }
      ROLE_PERMS_CACHE.set(r.role_code, perms);
    }
    console.log(`[auth] 已加载 ${ROLE_PERMS_CACHE.size} 个角色权限`);
  } catch (e) {
    console.error('[auth] 加载角色权限失败:', e.message);
  }
}

function getRolePermissions(roleCode) {
  if (ROLE_PERMS_CACHE.has(roleCode)) {
    const perms = ROLE_PERMS_CACHE.get(roleCode);
    // DB 存了非空数组 → 用 DB 的; DB 是空/[] → 走 default
    if (Array.isArray(perms) && perms.length > 0) return perms;
  }
  // 兜底: 旧角色或 DB 空 → DEFAULT_ROLE_PERMISSIONS
  return DEFAULT_ROLE_PERMISSIONS[roleCode] || [];
}

// P0-2: 用新 jwt 模块 (旧函数名保留, 业务层零改动)
function makeToken(uid, role, extra = {}) {
  const r = jwt.signAccess({ sub: uid, role, permissions: extra.permissions, full_name: extra.username });
  return r.token;
}
function verifyToken(token) {
  const p = jwt.verify(token);
  if (!p) return null;
  if (p.uid === undefined && p.sub !== undefined) p.uid = p.sub;
  return p;
}

function authMiddleware(req, res, next) {
  const publicPaths = ['/auth/login', '/auth/refresh', '/health', '/workflow/definitions', '/debug/db-stats'];
  if (publicPaths.includes(req.path)) return next();
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer /, '');
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: '未登录或 token 无效' });
  // P0-1: 从 token 取 permissions; 旧 token 没塞, 兜底用 DEFAULT_ROLE_PERMISSIONS
  if (!Array.isArray(payload.permissions)) {
    payload.permissions = getRolePermissions(payload.role);
  }
  req.user = payload;
  next();
}

// 兼容旧业务: 简单 role 字符串守卫
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足, 需要角色: ' + roles.join('/') });
    }
    next();
  };
}

// P0-1 升级: 细粒度 permission 守卫, 用 ApiError (P0-3 统一错误格式)
function requirePermission(...permCodes) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized('未登录'));
    const userPerms = req.user.permissions || getRolePermissions(req.user.role);
    const ok = permCodes.some(code => hasPermission(userPerms, code));
    if (!ok) {
      return next(ApiError.forbidden('权限不足, 需要: ' + permCodes.join(' / '), {
        user: req.user.role,
        have: userPerms.filter(p => p !== '*').slice(0, 10),
        need: permCodes,
      }));
    }
    next();
  };
}

const loginLimiter = rateLimit({
  windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  max: LOGIN_RATE_LIMIT_MAX,
  message: { error: '登录尝试过多，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  authMiddleware, loginLimiter, requireRole, requirePermission,
  makeToken, verifyToken, loadRolePermissions, getRolePermissions,
};
