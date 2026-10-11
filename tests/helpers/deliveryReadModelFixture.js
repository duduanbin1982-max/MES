"use strict";
// tests/helpers/deliveryReadModelFixture.js
// delivery/readModel 等价性测试用的固定数据。
// 表结构来自 tests/fixtures/delivery-tables.sql —— 那是从生产库 data/mes.db
// 导出的真实 DDL（列名/约束一致），由 .tmp/gen-delivery-fixture.js 生成。
//
// 数据设计目标（覆盖 readModel 里本地 helper 的各条分支）：
//   - instance 1: 成本有 project_cost_entries 明细 → 走 project 分支，variance 为负偏差 critical
//   - instance 2: 无 cost entries，只有 erp_cost_ledger → 走 erp 回退分支
//   - instance 3: progress=0 且 erp 有金额 → 触发 "earnedBudget<=0 && actual>0" 特殊分支
//   - instance 1 另有: 缺料(critical) / 未闭环 NCR(major, 有 open CAPA 与 pass 复检) /
//                      逾期采购跟催 / OEE 30 天内有数据

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const DDL = fs.readFileSync(path.join(__dirname, "..", "fixtures", "delivery-tables.sql"), "utf8");

function seedDeliveryDb() {
  const db = new Database(":memory:");
  // better-sqlite3 默认打开外键约束；导出的 DDL 里 equipment_instances 等表引用
  // 了未导出的表(equipment_models 等)，插数据前先关掉，避免 "no such table"。
  db.pragma("foreign_keys = OFF");
  db.exec(DDL);
  db.exec(`
    INSERT INTO equipment_instances
      (id, instance_code, instance_name, status, lifecycle_stage, progress_pct, customer_name,
       planned_end, contract_amount, contract_amount_unit, contract_no, project_no, serial_no)
    VALUES
      (1, 'TBM-1', '一号机', 'manufacturing', 'manufacturing', 50, '甲客户', '2026-12-31', 100, 'wan', 'C-1', 'P-1', 'SN-1'),
      (2, 'TBM-2', '二号机', 'completed',     'delivered',     100, '乙客户', '2026-06-30', 500000, 'yuan', 'C-2', 'P-2', 'SN-2'),
      (3, 'TBM-3', '三号机', 'manufacturing', 'manufacturing',   0, '丙客户', '2027-03-31',  80, 'wan', 'C-3', 'P-3', 'SN-3');

    INSERT INTO project_cost_entries
      (equipment_instance_id, cost_type, source_type, description, amount, currency, occurred_on, status)
    VALUES
      (1, 'material', 'purchase_order_item', '钢材', 600000, 'CNY', '2026-09-01', 'posted'),
      (1, 'labor',    'work_order',          '人工', 200000, 'CNY', '2026-09-10', 'posted'),
      (1, 'rework',   'manual',              '作废项', 999999, 'CNY', '2026-09-11', 'void');

    INSERT INTO erp_cost_ledger
      (entry_no, entry_date, gl_account_code, equipment_instance_id, description, debit_amount, credit_amount, currency, source_type, status)
    VALUES
      ('GL-1', '2026-09-05', '5001', 2, '外购件', 3000, 0, 'CNY', 'manual', 'posted'),
      ('GL-2', '2026-09-06', '5002', 3, '运费',   5000, 0, 'CNY', 'manual', 'posted');

    INSERT INTO materials (id, material_code, material_name, unit) VALUES (10, 'M-10', '钢材', 'kg');
    INSERT INTO work_orders (id, wo_code, equipment_instance_id, title, status, planned_start, planned_end)
      VALUES (20, 'WO-20', 1, '焊接', 'in_progress', '2026-09-01', '2026-09-30');
    INSERT INTO users (id, username, full_name, is_active) VALUES (30, 'u30', '张三', 1);

    INSERT INTO shortage_cases
      (id, work_order_id, equipment_instance_id, material_id, shortage_qty, status, owner_id, priority, updated_at, created_at)
    VALUES
      (100, 20, 1, 10, 5, 'open', 30, 'critical', '2026-09-20 10:00:00', '2026-09-19 10:00:00');

    INSERT INTO ncr_reports
      (id, ncr_code, equipment_instance_id, part_name, defect_desc, defect_qty, severity, created_by, created_at, closed_at)
    VALUES
      (200, 'NCR-200', 1, '钢材', '裂纹', 1, 'major', 30, '2026-09-18 10:00:00', NULL);
    INSERT INTO capa_actions (ncr_id, action_type, action_desc, status) VALUES (200, 'corrective', '返工', 'open');
    INSERT INTO ncr_rechecks (ncr_id, result) VALUES (200, 'pass');

    INSERT INTO oee_shift_log
      (equipment_instance_id, shift_date, shift_name, planned_minutes, operating_minutes, ideal_cycle_time, total_output, good_output)
    VALUES
      (1, date('now'), 'day', 480, 400, 0.5, 700, 660),
      (2, date('now'), 'day', 480, 300, 0.4, 500, 400);

    INSERT INTO suppliers (id, supplier_code, supplier_name) VALUES (50, 'S-50', '甲供应商');
    INSERT INTO purchase_orders (id, po_no, supplier_id, equipment_instance_id, status, expected_date, total_amount, currency)
      VALUES (40, 'PO-40', 50, 1, 'open', '2026-09-01', 123456, 'CNY');
    INSERT INTO purchase_order_items (id, po_id, material_id, quantity, unit, unit_price, total_price)
      VALUES (400, 40, 10, 10, 'kg', 100, 1000);
    INSERT INTO purchase_tracking
      (id, purchase_order_id, item_name, supplier, order_date, planned_delivery, delay_days, status,
       equipment_instance_id, material_id, owner_name)
    VALUES
      (500, 40, '钢材', '甲供应商', '2026-08-01', '2026-09-01', 10, 'following', 1, 10, '李四');
  `);
  return db;
}

// golden 对比前必须过的归一化。
//
// 唯一与"墙上时钟"有关的内容是异常文案里的已延期天数（读模型用 SQL 的
// julianday('now') 算差值），实测在 11.5 → 11.6 之间漂移，会让用例假红。
// 把它替换成占位符；其余字段都是确定性的，不做任何弱化。
const VOLATILE_TEXT = [
  [/已延期 [\d.]+ 天/g, "已延期 N 天"],
  [/超期 [\d.]+ 天/g, "超期 N 天"],
  [/逾期 [\d.]+ 天/g, "逾期 N 天"],
];

function normalizeGolden(value) {
  if (Array.isArray(value)) return value.map(normalizeGolden);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = normalizeGolden(item);
    return out;
  }
  if (typeof value === "string") {
    return VOLATILE_TEXT.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
  }
  return value;
}

module.exports = { seedDeliveryDb, normalizeGolden };
