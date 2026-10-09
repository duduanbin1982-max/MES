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
const { hasPermission } = require('../app/permissions');

// SECRET 校验在 app/jwt.js 模块加载时已做
const LOGIN_RATE_LIMIT_WINDOW_MS = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || '60000', 10);
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '10', 10);

// P0-1: 内存缓存 role permissions
// 2026-10-10 (静态分析 v1 #5): 缓存实现抽到 app/rolePermissions.js，
//   让 services/userManagement.js 这类写路径复用同一份缓存并主动 reload，
//   不再依赖"只在启动时加载一次"。此处 require + 重新导出，对外 API 不变。
const { loadRolePermissions, getRolePermissions } = require('../app/rolePermissions');

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
  // P0-2 brooks-lint: default-deny 原则
  //   之前: publicPaths = ['/auth/login', '/auth/refresh', '/health', '/workflow/definitions', '/debug/db-stats']
  //   现在: 显式列白名单, 其它 /api/* 全部走 token + requirePermission
  //   删除: /debug/db-stats (R3 dup - 业务数据走 admin gate)
  //   保留: /auth/login, /auth/refresh, /health (外部探活)
  //   2026-10-10 (静态分析 v1 #6): 移除 /workflow/definitions —— 它只被登录后的
  //     前端 WorkflowEngine.vue 调用, 匿名暴露工作流状态机词汇没有必要。
  //     nginx 侧 4 个月日志里只有 1 次匿名探测(且 404), 无真实匿名调用方。
  //     改为登录可读: apiPermissions.js 里有对应的全角色只读规则。
  //   /api/auth/me + /api/auth/logout: 不放 publicPaths, 但 auth.js 内部 next() 跳过中间件
  //   /api/help/manual: 加 requirePermission('help:read') in route handler
  const publicPaths = ['/auth/login', '/auth/refresh', '/health'];
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


// P0: Access token refresh - 验证旧 access token（允许过期但有效签名）签发新 access token
function handleRefresh(req, res, next) {
  try {
    const { access_token } = req.body || {};
    if (!access_token) return res.status(400).json({ error: 'access_token 必填' });
    const payload = jwt.verify(access_token);
    if (!payload) return res.status(401).json({ error: 'access_token 无效' });
    if (payload.typ !== 'access' && payload.typ !== undefined) {
      return res.status(401).json({ error: 'token 类型错误 (需 access token)' });
    }
    // Allow expired tokens as long as signature is valid (jwt.verify returns payload with expired flag)
    const uid = payload.sub || payload.uid;
    if (!uid) return res.status(401).json({ error: 'token 缺少用户标识' });
    // Re-fetch role permissions from cache (may have changed since token was issued)
    const permissions = getRolePermissions(payload.role);
    const access = jwt.signAccess({ sub: uid, role: payload.role, permissions, full_name: payload.full_name });
    res.json({
      access_token: access.token,
      token_type: 'Bearer',
      access_exp: access.exp,
      permissions,
    });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  authMiddleware, loginLimiter, requireRole, requirePermission,
  makeToken, verifyToken, loadRolePermissions, getRolePermissions,
  handleRefresh,
};
