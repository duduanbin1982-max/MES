'use strict';

/**
 * rbac.test.js
 * P0-1 RBAC permissions 重构测试
 * 13 用例:
 *  1. hasPermission '*' 全部通过
 *  2. hasPermission 精确匹配
 *  3. hasPermission 资源通配 'material:*' 匹配 'material:write'
 *  4. hasPermission 不匹配返回 false
 *  5. DEFAULT_ROLE_PERMISSIONS admin -> ['*']
 *  6. DEFAULT_ROLE_PERMISSIONS foreman 有 material:read
 *  7. DEFAULT_ROLE_PERMISSIONS welder 无 material:read
 *  8. loadRolePermissions DB 覆盖 default
 *  9. loadRolePermissions DB NULL 走 default
 * 10. getRolePermissions 未知 role 返回 []
 * 11. token payload permissions 字段
 * 12. setRolePermissions 写库后立即刷新缓存 (v1 #5)
 * 13. 空权限写入后回落内置默认值
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { hasPermission, DEFAULT_ROLE_PERMISSIONS } = require('../app/permissions');
const { loadRolePermissions, getRolePermissions, makeToken, verifyToken } = require('../middleware/auth');

function freshDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE roles (id INTEGER PRIMARY KEY, role_code TEXT UNIQUE, role_name TEXT, permissions TEXT)');
  return db;
}

test('P0-1.RBAC.1 hasPermission 通配 * 通过所有', () => {
  assert.equal(hasPermission(['*'], 'material:write'), true);
  assert.equal(hasPermission(['*'], 'user:admin'), true);
  assert.equal(hasPermission(['*'], 'any:thing:here'), true);
});

test('P0-1.RBAC.2 hasPermission 精确匹配', () => {
  assert.equal(hasPermission(['material:write'], 'material:write'), true);
  assert.equal(hasPermission(['material:read', 'material:write'], 'material:write'), true);
});

test('P0-1.RBAC.3 hasPermission 资源通配 material:* 匹配 material:write', () => {
  assert.equal(hasPermission(['material:*'], 'material:write'), true);
  assert.equal(hasPermission(['material:*'], 'material:read'), true);
  assert.equal(hasPermission(['material:*'], 'material:admin'), true);
  assert.equal(hasPermission(['material:*'], 'work_order:write'), false);
});

test('P0-1.RBAC.4 hasPermission 不匹配返回 false', () => {
  assert.equal(hasPermission(['material:read'], 'material:write'), false);
  assert.equal(hasPermission(['quality:write'], 'material:write'), false);
  assert.equal(hasPermission([], 'material:write'), false);
  assert.equal(hasPermission(null, 'material:write'), false);
});

test('P0-1.RBAC.5 DEFAULT_ROLE_PERMISSIONS admin -> [\'*\']', () => {
  assert.deepEqual(DEFAULT_ROLE_PERMISSIONS.admin, ['*']);
});

test('P0-1.RBAC.6 DEFAULT_ROLE_PERMISSIONS foreman 有 material:read', () => {
  assert.ok(hasPermission(DEFAULT_ROLE_PERMISSIONS.foreman, 'material:read'));
  assert.ok(hasPermission(DEFAULT_ROLE_PERMISSIONS.foreman, 'work_order:write'));
});

test('P0-1.RBAC.7 DEFAULT_ROLE_PERMISSIONS welder 无 material:read', () => {
  assert.equal(hasPermission(DEFAULT_ROLE_PERMISSIONS.welder, 'material:read'), false);
  assert.equal(hasPermission(DEFAULT_ROLE_PERMISSIONS.welder, 'work_order:read'), true);
});

test('P0-1.RBAC.8 loadRolePermissions DB 覆盖 default', () => {
  const db = freshDb();
  db.prepare('INSERT INTO roles (id, role_code, role_name, permissions) VALUES (?, ?, ?, ?)').run(1, 'foreman', '车间主任', JSON.stringify(['custom:perm']));
  loadRolePermissions(db);
  const perms = getRolePermissions('foreman');
  assert.deepEqual(perms, ['custom:perm']);  // DB 覆盖默认
});

test('P0-1.RBAC.9 loadRolePermissions DB NULL/[] 走 default', () => {
  const db = freshDb();
  db.prepare('INSERT INTO roles (id, role_code, role_name, permissions) VALUES (?, ?, ?, ?)').run(1, 'foreman', '车间主任', null);
  loadRolePermissions(db);
  const perms = getRolePermissions('foreman');
  assert.ok(perms.length > 0);  // 走 default
  assert.ok(hasPermission(perms, 'material:read'));
});

test('P0-1.RBAC.10 getRolePermissions 未知 role 返回 []', () => {
  const db = freshDb();
  loadRolePermissions(db);
  const perms = getRolePermissions('nonsense_role_xyz');
  assert.deepEqual(perms, []);
});

test('P0-1.RBAC.11 token payload 含 permissions', () => {
  const token = makeToken(99, 'foreman', { permissions: ['material:read', 'work_order:write'] });
  const payload = verifyToken(token);
  assert.ok(payload);
  assert.equal(payload.uid, 99);
  assert.equal(payload.role, 'foreman');
  assert.deepEqual(payload.permissions, ['material:read', 'work_order:write']);
});

// 2026-10-10 (静态分析 v1 #5): 角色权限缓存必须随写路径刷新。
// routes/roles.js 已有 reload；这里守住 services/userManagement.js#setRolePermissions，
// 它曾经只写库不刷缓存 → 角色降权后新签发的 token 仍带旧权限，直到服务重启。
test('P0-1.RBAC.12 setRolePermissions 写库后立即刷新权限缓存', () => {
  const db = freshDb();
  db.prepare('INSERT INTO roles (id, role_code, role_name, permissions) VALUES (?, ?, ?, ?)')
    .run(1, 'planner', '计划员', JSON.stringify(['work_order:read']));
  loadRolePermissions(db);
  assert.deepEqual(getRolePermissions('planner'), ['work_order:read']);

  const userManagement = require('../services/userManagement');
  userManagement.setDb(db);
  const result = userManagement.setRolePermissions(1, ['work_order:read', 'material:read']);
  assert.equal(result.ok, true);
  assert.deepEqual(getRolePermissions('planner'), ['material:read', 'work_order:read']);
  assert.deepEqual(
    JSON.parse(db.prepare('SELECT permissions FROM roles WHERE id = 1').get().permissions),
    ['material:read', 'work_order:read']
  );
});

test('P0-1.RBAC.13 空权限写入后回落内置默认值而非残留旧权限', () => {
  const db = freshDb();
  db.prepare('INSERT INTO roles (id, role_code, role_name, permissions) VALUES (?, ?, ?, ?)')
    .run(1, 'foreman', '车间主任', JSON.stringify(['material:read']));
  loadRolePermissions(db);
  assert.deepEqual(getRolePermissions('foreman'), ['material:read']);

  const userManagement = require('../services/userManagement');
  userManagement.setDb(db);
  userManagement.setRolePermissions(1, []);
  // DB 变空数组 → getRolePermissions 回落 DEFAULT_ROLE_PERMISSIONS，不能保留已撤销的 material:read-only 集
  const perms = getRolePermissions('foreman');
  assert.ok(perms.length > 0, '空权限应回落内置默认，而不是空数组');
  assert.ok(hasPermission(perms, 'work_order:write'), '默认 foreman 权限应生效');
});