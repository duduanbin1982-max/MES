"use strict";
// scripts/migrate-delivery-linkage.js
// 2026-11-05（DLV-5 存量数据断链治理）：
//   · acceptance_records.delivery_order_id 空缺 → 关联同实例交付单（accepted > arrived > 最近非取消）
//   · acceptance_records.milestone_id 空缺 → 同实例唯一合同里程碑时关联
//   · project_payments.milestone_id 空缺 → 同实例唯一合同里程碑时关联
//   · contract_milestones.planned_date 空缺 → 用实例 planned_start / 创建日期补
//   · contract_milestones.payment_amount 为 0 且 payment_pct>0 → 按合同额计算
// 用法：
//   node scripts/migrate-delivery-linkage.js --verify
//   node scripts/migrate-delivery-linkage.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

function pickDelivery(db, instanceId) {
  const rows = db.prepare("SELECT id, status FROM delivery_orders WHERE equipment_instance_id = ? AND status <> 'cancelled' ORDER BY CASE status WHEN 'accepted' THEN 0 WHEN 'arrived' THEN 1 WHEN 'in_transit' THEN 2 WHEN 'shipped' THEN 3 ELSE 4 END, COALESCE(planned_date, created_at) DESC, id DESC").all(instanceId);
  return rows[0] || null;
}

function planLinkage(db) {
  const changes = [];
  const acceptances = db.prepare("SELECT * FROM acceptance_records WHERE delivery_order_id IS NULL OR milestone_id IS NULL").all();
  for (const acceptance of acceptances) {
    if (!acceptance.delivery_order_id) {
      const delivery = pickDelivery(db, acceptance.equipment_instance_id);
      if (delivery) changes.push({ table: "acceptance_records", id: acceptance.id, field: "delivery_order_id", value: delivery.id, reason: "同实例交付单" });
      else changes.push({ table: "delivery_orders", create: true, equipment_instance_id: acceptance.equipment_instance_id, acceptance_id: acceptance.id, reason: "验收单缺少可关联交付单" });
    }
    if (!acceptance.milestone_id) {
      const milestones = db.prepare("SELECT id FROM contract_milestones WHERE equipment_instance_id = ?").all(acceptance.equipment_instance_id);
      if (milestones.length === 1) changes.push({ table: "acceptance_records", id: acceptance.id, field: "milestone_id", value: milestones[0].id, reason: "同实例唯一合同里程碑" });
    }
  }
  const payments = db.prepare("SELECT * FROM project_payments WHERE milestone_id IS NULL").all();
  for (const payment of payments) {
    const milestones = db.prepare("SELECT id FROM contract_milestones WHERE equipment_instance_id = ?").all(payment.equipment_instance_id);
    if (milestones.length === 1) changes.push({ table: "project_payments", id: payment.id, field: "milestone_id", value: milestones[0].id, reason: "同实例唯一合同里程碑" });
  }
  // 同实例没有合同里程碑时，自动补建一个占位里程碑，闭合验收单→里程碑断链（标记【自动补建】）
  const instancesWithAcceptance = db.prepare("SELECT DISTINCT equipment_instance_id FROM acceptance_records WHERE milestone_id IS NULL").all();
  for (const row of instancesWithAcceptance) {
    const existing = db.prepare("SELECT id FROM contract_milestones WHERE equipment_instance_id = ?").all(row.equipment_instance_id);
    if (existing.length) continue;
    changes.push({ table: "contract_milestones", create: true, equipment_instance_id: row.equipment_instance_id, milestone_name: "【自动补建】验收里程碑", status: "pending", sequence: 1, reason: "验收单缺少可关联里程碑" });
  }
  const milestones = db.prepare("SELECT cm.*, ei.planned_start, ei.contract_amount FROM contract_milestones cm JOIN equipment_instances ei ON ei.id = cm.equipment_instance_id").all();
  for (const milestone of milestones) {
    if (!milestone.planned_date) {
      const planned = milestone.planned_start || (milestone.created_at ? String(milestone.created_at).slice(0, 10) : null);
      if (planned) changes.push({ table: "contract_milestones", id: milestone.id, field: "planned_date", value: planned, reason: "实例计划开始/创建日期" });
    }
    if (!(Number(milestone.payment_amount) > 0) && Number(milestone.payment_pct) > 0 && Number(milestone.contract_amount) > 0) {
      const amount = Math.round(Number(milestone.contract_amount) * Number(milestone.payment_pct)) / 100;
      changes.push({ table: "contract_milestones", id: milestone.id, field: "payment_amount", value: amount, reason: "合同额×付款比例" });
    }
  }
  return changes;
}

function applyChanges(db, changes) {
  const statement = {};
  const tx = db.transaction(() => {
    for (const change of changes) {
      if (change.create && change.table === "delivery_orders") {
        const instance = db.prepare("SELECT instance_code, planned_start FROM equipment_instances WHERE id = ?").get(change.equipment_instance_id) || {};
        const deliveryNo = "DO-AUTO-" + String(instance.instance_code || change.equipment_instance_id) + "-001";
        const existing = db.prepare("SELECT id FROM delivery_orders WHERE delivery_no = ?").get(deliveryNo);
        const deliveryId = existing ? existing.id : db.prepare("INSERT INTO delivery_orders (delivery_no, equipment_instance_id, delivery_type, planned_date, actual_date, status, notes) VALUES (?, ?, 'machine', ?, ?, 'accepted', ?)")
          .run(deliveryNo, change.equipment_instance_id, instance.planned_start || null, instance.planned_start || null, "【自动补建】验收单关联交付单").lastInsertRowid;
        db.prepare("UPDATE acceptance_records SET delivery_order_id = ? WHERE equipment_instance_id = ? AND delivery_order_id IS NULL")
          .run(deliveryId, change.equipment_instance_id);
        continue;
      }
      if (change.create) {
        const created = db.prepare("INSERT INTO contract_milestones (equipment_instance_id, milestone_name, status, sequence) VALUES (?, ?, ?, ?)")
          .run(change.equipment_instance_id, change.milestone_name, change.status, change.sequence);
        db.prepare("UPDATE acceptance_records SET milestone_id = ? WHERE equipment_instance_id = ? AND milestone_id IS NULL")
          .run(created.lastInsertRowid, change.equipment_instance_id);
        continue;
      }
      const key = change.table + ":" + change.field;
      if (!statement[key]) statement[key] = db.prepare(`UPDATE ${change.table} SET ${change.field} = ? WHERE id = ?`);
      statement[key].run(change.value, change.id);
    }
  });
  tx();
  return changes.length;
}

function main() {
  const apply = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const changes = planLinkage(db);
    console.log(`[delivery-linkage] 数据库: ${DB_PATH}`);
    console.log(`计划修复 ${changes.length} 处：`);
    for (const change of changes) {
      if (change.create && change.table === "delivery_orders") console.log(`  - 新建 delivery_orders（实例 ${change.equipment_instance_id}，自动补建）`);
      else if (change.create) console.log(`  - 新建 contract_milestones（实例 ${change.equipment_instance_id}，${change.milestone_name}）`);
      else console.log(`  - ${change.table}#${change.id} ${change.field} → ${change.value}（${change.reason}）`);
    }
    if (apply && changes.length) {
      const changed = applyChanges(db, changes);
      console.log(`✅ 已修复 ${changed} 处`);
    } else if (!apply) {
      console.log("（未执行，加 --apply 生效）");
    }
    const remaining = db.prepare(`SELECT
        (SELECT COUNT(*) FROM acceptance_records WHERE delivery_order_id IS NULL) AS acceptance_missing_delivery,
        (SELECT COUNT(*) FROM acceptance_records WHERE milestone_id IS NULL) AS acceptance_missing_milestone,
        (SELECT COUNT(*) FROM project_payments WHERE milestone_id IS NULL) AS payment_missing_milestone,
        (SELECT COUNT(*) FROM contract_milestones WHERE planned_date IS NULL) AS milestone_missing_date`).get();
    console.log("剩余缺口:", JSON.stringify(remaining));
    process.exitCode = 0;
  } finally { db.close(); }
}

module.exports = { planLinkage, applyChanges, pickDelivery };

if (require.main === module) main();
