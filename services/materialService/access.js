"use strict";

function createAccessGuards(ApiError) {
  const requireLogin = (req) => {
    if (!req.user) {
      throw ApiError.unauthorized();
    }
    return false;
  };

  const requirePermission = (...permissionCodes) => (req) => {
    if (!req.user) {
      throw ApiError.unauthorized();
    }
    const userPermissions = req.user.permissions || [];
    const allowed = permissionCodes.some((code) => userPermissions.includes("*") || userPermissions.includes(code) ||
      userPermissions.some((permission) => permission.endsWith(":*") && code.startsWith(permission.slice(0, -1))));
    if (!allowed) {
      throw ApiError.forbidden("权限不足, 需要: " + permissionCodes.join(" / "));
    }
    return false;
  };

  return { requireLogin, requirePermission };
}

module.exports = { createAccessGuards };
