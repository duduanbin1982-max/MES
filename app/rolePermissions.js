"use strict";
// app/rolePermissions.js
// 角色权限内存缓存（2026-10-10 从 middleware/auth.js 抽出）
//
// 背景（静态分析 v1 发现 #5）：缓存原先只在 server.js 启动时加载一次，
// routes/roles.js 的增删改会 reload，但 services/userManagement.js 的
// setRolePermissions 没有 reload —— 若该函数被路由接到，角色降权后新签发的
// token 仍会携带旧权限，直到人工重启服务。
//
// 收敛到本模块后，所有写路径都调用同一个 loadRolePermissions(db)，
// 读取方（middleware/auth.js）通过 getRolePermissions(roleCode) 取值。

const { DEFAULT_ROLE_PERMISSIONS } = require("./permissions");

const logger = require("./logger").createLogger("auth");

// Map<role_code, permissions_array>
const ROLE_PERMS_CACHE = new Map();

/**
 * 从 roles 表重建权限缓存。
 * @returns {number|null} 缓存条目数；db 缺失返回 0；查询失败返回 null
 */
function loadRolePermissions(db) {
  if (!db) return 0;
  try {
    const rows = db.prepare("SELECT role_code, permissions FROM roles").all();
    ROLE_PERMS_CACHE.clear();
    for (const r of rows) {
      let perms = [];
      try { perms = JSON.parse(r.permissions || "[]"); } catch (_e) { perms = []; }
      ROLE_PERMS_CACHE.set(r.role_code, perms);
    }
    logger.info(`[auth] 已加载 ${ROLE_PERMS_CACHE.size} 个角色权限`);
    return ROLE_PERMS_CACHE.size;
  } catch (e) {
    logger.error("[auth] 加载角色权限失败:", e.message);
    return null;
  }
}

/**
 * 取角色权限：DB 里有非空数组就用 DB 的，否则回落到内置默认表。
 */
function getRolePermissions(roleCode) {
  if (ROLE_PERMS_CACHE.has(roleCode)) {
    const perms = ROLE_PERMS_CACHE.get(roleCode);
    // DB 存了非空数组 → 用 DB 的; DB 是空/[] → 走 default
    if (Array.isArray(perms) && perms.length > 0) return perms;
  }
  // 兜底: 旧角色或 DB 空 → DEFAULT_ROLE_PERMISSIONS
  return DEFAULT_ROLE_PERMISSIONS[roleCode] || [];
}

/** 当前已缓存的 role_code 列表（排障/测试用，不参与鉴权） */
function cachedRoleCodes() {
  return [...ROLE_PERMS_CACHE.keys()];
}

module.exports = { loadRolePermissions, getRolePermissions, cachedRoleCodes };
