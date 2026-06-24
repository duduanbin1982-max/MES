// middleware/auth.js
// 2026-06-22 brooks-lint R2 修复：从 server.js 抽出
// 2026-06-23 settings 化：加 requirePermission(permCode) 守卫
//        适配 roles 表 (id, role_code, role_name, permissions JSON, description)
//        permissions 数组支持 'project:read' / 'project:*' / '*' (admin)

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const path = require('path');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error('[middleware/auth] FATAL: JWT_SECRET 缺失或太短（<32字符）。请检查 .env');
  process.exit(1);
}
const JWT_EXPIRE_HOURS = parseInt(process.env.JWT_EXPIRE_HOURS || '24', 10);
const LOGIN_RATE_LIMIT_WINDOW_MS = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || '60000', 10);
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '10', 10);

function makeToken(uid, role) {
  const payload = JSON.stringify({ uid, role, exp: Date.now() + JWT_EXPIRE_HOURS * 3600 * 1000 });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
  return b64 + '.' + sig;
}

function verifyToken(token) {
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (_e) { return null; }
}

function authMiddleware(req, res, next) {
  const publicPaths = ['/auth/login', '/health'];
  if (publicPaths.includes(req.path)) return next();
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer /, '');
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: '未登录或 token 无效' });
  req.user = payload;
  next();
}

// 角色字符串守卫（兼容旧代码，简单限制）
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足, 需要角色: ' + roles.join('/') });
    }
    next();
  };
}

// 权限码守卫（细粒度，按 roles.permissions JSON 数组判断）
// permCode 例: 'project:read' / 'project:write' / 'settings:write'
// 用户的 permissions 数组里匹配 'project:*' / '*' / permCode 之一即通过
function requirePermission(...permCodes) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    // 延迟 require db（避免循环依赖）
    const db = require('../db');
    const row = db.prepare('SELECT permissions FROM roles r JOIN users u ON u.role_code = r.role_code WHERE u.id = ?').get(req.user.uid);
    if (!row) return res.status(403).json({ error: '角色未配置: ' + (req.user.role || '-') });
    let perms = [];
    try { perms = JSON.parse(row.permissions || '[]'); } catch (_e) { perms = []; }
    const ok = permCodes.some(code =>
      perms.includes('*') || perms.includes(code) ||
      perms.some(p => p.endsWith(':*') && code.startsWith(p.slice(0, -1)))
    );
    if (!ok) {
      return res.status(403).json({ error: '权限不足, 需要: ' + permCodes.join(' / ') });
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

module.exports = { authMiddleware, loginLimiter, requireRole, requirePermission, makeToken, verifyToken };
