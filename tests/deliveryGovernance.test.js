'use strict';

/**
 * deliveryGovernance.test.js
 * 2026-11-05 DLV-5/6/7 整改验证（内存库，直接调用迁移脚本导出的纯函数）：
 *   1) DLV-5 断链回填：验收单→交付单/里程碑、收款→里程碑、里程碑计划日期
 *   2) DLV-5 占位补建：无交付单/无里程碑时自动补建并关联
 *   3) DLV-6 验收表统一：旧清单 → acceptance_records 字段映射 + 幂等
 *   4) DLV-7 权限细分：角色补 delivery:read/write；默认角色含新权限
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { planLinkage, applyChanges } = require('../scripts/migrate-delivery-linkage');
const { planMigration, applyMigration } = require('../scripts/migrate-acceptance-unify');
const { planPermissions, applyPlan } = require('../scripts/migrate-delivery-permissions');
const { DEFAULT_ROLE_PERMISSIONS } = require('../app/permissions');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, planned_start TEXT, contract_amount REAL DEFAULT 0)`);
  db.exec(`CREATE TABLE delivery_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_no TEXT UNIQUE, equipment_instance_id INTEGER, milestone_id INTEGER, delivery_type TEXT, planned_date TEXT, actual_date TEXT, status TEXT DEFAULT 'planned', transport_mode TEXT, carrier TEXT, tracking_no TEXT, ship_to TEXT, contact_name TEXT, contact_phone TEXT, package_count INTEGER, gross_weight REAL, certificate_document_id INTEGER, notes TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT)`);
  db.exec(`CREATE TABLE acceptance_records (id INTEGER PRIMARY KEY AUTOINCREMENT, acceptance_no TEXT UNIQUE, equipment_instance_id INTEGER, delivery_order_id INTEGER, milestone_id INTEGER, acceptance_type TEXT, planned_date TEXT, actual_date TEXT, result TEXT DEFAULT 'pending', condition_note TEXT, customer_name TEXT, signer_name TEXT, signer_title TEXT, signed_at TEXT, report_document_id INTEGER, notes TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT)`);
  db.exec(`CREATE TABLE contract_milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, milestone_name TEXT, planned_date TEXT, actual_date TEXT, payment_pct REAL DEFAULT 0, payment_amount REAL DEFAULT 0, status TEXT DEFAULT 'pending', sequence INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT)`);
  db.exec(`CREATE TABLE project_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, milestone_id INTEGER, amount REAL, received_date TEXT, payment_method TEXT, voucher_no TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.exec(`CREATE TABLE acceptance_checklists (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, checklist_name TEXT, items TEXT DEFAULT '[]', status TEXT DEFAULT 'pending', inspector TEXT, customer_rep TEXT, result TEXT, issues TEXT, sign_date TEXT, signature_path TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT)`);
  db.exec(`CREATE TABLE roles (id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT UNIQUE, role_name TEXT, permissions TEXT DEFAULT '[]')`);
  return db;
}

test('DG.1 断链回填：验收单关联交付单与里程碑、收款关联里程碑', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO equipment_instances (id, instance_code, planned_start, contract_amount) VALUES (1, 'TBM-001', '2026-07-01', 1000000)`).run();
  db.prepare(`INSERT INTO delivery_orders (id, delivery_no, equipment_instance_id, status) VALUES (2, 'DO-1', 1, 'accepted')`).run();
  db.prepare(`INSERT INTO delivery_orders (id, delivery_no, equipment_instance_id, status) VALUES (3, 'DO-2', 1, 'planned')`).run();
  db.prepare(`INSERT INTO contract_milestones (id, equipment_instance_id, milestone_name, payment_pct, payment_amount) VALUES (1, 1, '预付款', 30, 0)`).run();
  db.prepare(`INSERT INTO acceptance_records (id, acceptance_no, equipment_instance_id, result) VALUES (1, 'AC-1', 1, 'passed')`).run();
  db.prepare(`INSERT INTO project_payments (id, equipment_instance_id, amount) VALUES (1, 1, 10000)`).run();
  const changes = planLinkage(db);
  assert.ok(changes.some((row) => row.table === 'acceptance_records' && row.field === 'delivery_order_id' && row.value === 2), '应优先关联 accepted 交付单');
  assert.ok(changes.some((row) => row.table === 'acceptance_records' && row.field === 'milestone_id'));
  assert.ok(changes.some((row) => row.table === 'project_payments' && row.field === 'milestone_id' && row.value === 1));
  assert.ok(changes.some((row) => row.table === 'contract_milestones' && row.field === 'planned_date' && row.value === '2026-07-01'));
  assert.ok(changes.some((row) => row.table === 'contract_milestones' && row.field === 'payment_amount' && row.value === 300000));
  applyChanges(db, changes);
  const acceptance = db.prepare(`SELECT delivery_order_id, milestone_id FROM acceptance_records WHERE id = 1`).get();
  assert.equal(acceptance.delivery_order_id, 2);
  assert.ok(acceptance.milestone_id);
  assert.equal(planLinkage(db).length, 0, '回填后应无缺口');
  db.close();
});

test('DG.2 占位补建：无交付单/无里程碑时自动补建并关联', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO equipment_instances (id, instance_code, planned_start) VALUES (8, 'DEMO-8', '2026-11-01')`).run();
  db.prepare(`INSERT INTO acceptance_records (id, acceptance_no, equipment_instance_id, result) VALUES (1, 'AC-8', 8, 'passed')`).run();
  applyChanges(db, planLinkage(db));
  applyChanges(db, planLinkage(db));
  const acceptance = db.prepare(`SELECT delivery_order_id, milestone_id FROM acceptance_records WHERE id = 1`).get();
  assert.ok(acceptance.delivery_order_id, '应补建并关联交付单');
  assert.ok(acceptance.milestone_id, '应补建并关联里程碑');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM delivery_orders`).get().c, 1, '占位交付单幂等');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM contract_milestones`).get().c, 1, '占位里程碑幂等');
  db.close();
});

test('DG.3 验收表统一：旧清单迁移到 acceptance_records（字段映射 + 幂等）', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO equipment_instances (id, instance_code) VALUES (1, 'TBM-001')`).run();
  db.prepare(`INSERT INTO acceptance_checklists (id, equipment_instance_id, checklist_name, items, status, inspector, customer_rep, result, sign_date) VALUES (1, 1, 'Test ACL', '[]', 'pending', '李工', '张工', 'passed', '2026-11-02')`).run();
  const plan = planMigration(db);
  assert.equal(plan.length, 1);
  assert.equal(applyMigration(db, plan), 1);
  const record = db.prepare(`SELECT * FROM acceptance_records WHERE acceptance_no = 'AC-LEGACY-1'`).get();
  assert.ok(record, '应生成 AC-LEGACY-1');
  assert.equal(record.result, 'passed');
  assert.equal(record.signer_name, '李工');
  assert.equal(record.customer_name, '张工');
  assert.match(record.notes, /CHECKLIST:.*Test ACL/);
  assert.equal(db.prepare(`SELECT status FROM acceptance_checklists WHERE id = 1`).get().status, 'archived', '旧表应归档');
  assert.equal(applyMigration(db, planMigration(db)), 0, '重复执行应幂等');
  db.close();
});

test('DG.4 权限细分：角色补 delivery 权限，默认角色包含新权限', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO roles (role_code, role_name, permissions) VALUES ('admin', '管理员', '["*"]')`).run();
  db.prepare(`INSERT INTO roles (role_code, role_name, permissions) VALUES ('planner', '计划员', '["equipment:read"]')`).run();
  db.prepare(`INSERT INTO roles (role_code, role_name, permissions) VALUES ('sales', '销售', '["equipment:read"]')`).run();
  const plan = planPermissions(db);
  const planner = plan.find((row) => row.role_code === 'planner');
  const sales = plan.find((row) => row.role_code === 'sales');
  assert.deepEqual(planner.missing, ['delivery:read', 'delivery:write']);
  assert.deepEqual(sales.missing, ['delivery:read']);
  applyPlan(db, plan);
  const plannerAfter = JSON.parse(db.prepare(`SELECT permissions FROM roles WHERE role_code = 'planner'`).get().permissions);
  assert.ok(plannerAfter.includes('delivery:write'));
  assert.ok(DEFAULT_ROLE_PERMISSIONS.planner.includes('delivery:write'));
  assert.ok(DEFAULT_ROLE_PERMISSIONS.sales.includes('delivery:read'));
  assert.ok(!DEFAULT_ROLE_PERMISSIONS.sales.includes('delivery:write'), '销售不应有写权限');
  db.close();
});
