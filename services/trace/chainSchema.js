"use strict";
// services/trace/chainSchema.js
// P0-2（2026-10-18）：追溯五级链路的"软关联"列与索引。
//
// 背景：链路目标是「项目装备 → 工单 → 工序 → 批次/序列号 → 检验与文档证据」。
// 现有表大部分环节已通，但有几处断点只能靠多跳推导（例如 weld_records 没有 equipment_instance_id，
// 要先 join work_orders 才能回到设备）。这里做两件事：
//   1) 给断点表补"软关联"列（允许为空；有值就少一跳，没值仍可退化推导）
//   2) 补索引 + 回填可推导的值（幂等）
// 注意：所有列都可空，不影响既有写入路径；是否填充由业务逐步补齐。

const SOFT_LINKS = [
  // [表, 列定义, 说明]
  ["instance_bom", "material_lot_id INTEGER", "BOM 行 ↔ 实装批次（设计 BOM 与实物批次打通）"],
  ["instance_bom", "serial_id INTEGER", "BOM 行 ↔ 序列号（单件追溯）"],
  ["weld_records", "equipment_instance_id INTEGER", "焊缝 ↔ 设备实例（原先只能经工单推导）"],
  ["weld_records", "process_node_id INTEGER", "焊缝 ↔ 工序节点"],
  ["assembly_records", "equipment_instance_id INTEGER", "装配记录 ↔ 设备实例"],
  ["assembly_records", "serial_id INTEGER", "装配记录 ↔ 序列号"],
  ["serial_numbers", "work_order_id INTEGER", "序列号 ↔ 最后装配工单"],
  ["serial_numbers", "process_node_id INTEGER", "序列号 ↔ 工序节点"],
  ["documents", "work_order_id INTEGER", "文档 ↔ 工单（图纸/作业指导书挂到执行工单）"],
  ["qc_inspections", "serial_id INTEGER", "检验记录 ↔ 序列号"],
];

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_bom_lot ON instance_bom(material_lot_id)",
  "CREATE INDEX IF NOT EXISTS idx_bom_serial ON instance_bom(serial_id)",
  "CREATE INDEX IF NOT EXISTS idx_weld_instance ON weld_records(equipment_instance_id)",
  "CREATE INDEX IF NOT EXISTS idx_weld_process_node ON weld_records(process_node_id)",
  "CREATE INDEX IF NOT EXISTS idx_asm_instance ON assembly_records(equipment_instance_id)",
  "CREATE INDEX IF NOT EXISTS idx_serial_work_order ON serial_numbers(work_order_id)",
  "CREATE INDEX IF NOT EXISTS idx_doc_work_order ON documents(work_order_id)",
  "CREATE INDEX IF NOT EXISTS idx_qc_serial ON qc_inspections(serial_id)",
  "CREATE INDEX IF NOT EXISTS idx_qc_work_order ON qc_inspections(work_order_id)",
];

function addColumn(db, table, ddl) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    return true;
  } catch (_error) {
    return false; // 已存在
  }
}

function ensureChainSchema(db) {
  const added = [];
  for (const [table, ddl] of SOFT_LINKS) {
    if (addColumn(db, table, ddl)) added.push(`${table}.${ddl.split(" ")[0]}`);
  }
  for (const sql of INDEXES) {
    try { db.exec(sql); } catch (_error) { /* 表不存在时跳过（测试环境） */ }
  }

  // 回填可推导的值（幂等，只补 NULL）
  const backfills = [
    ["weld_records", `UPDATE weld_records SET equipment_instance_id = (
        SELECT wo.equipment_instance_id FROM work_orders wo WHERE wo.id = weld_records.work_order_id
      ) WHERE equipment_instance_id IS NULL AND work_order_id IS NOT NULL`],
    ["assembly_records", `UPDATE assembly_records SET equipment_instance_id = (
        SELECT wo.equipment_instance_id FROM work_orders wo WHERE wo.id = assembly_records.work_order_id
      ) WHERE equipment_instance_id IS NULL AND work_order_id IS NOT NULL`],
    ["serial_numbers", `UPDATE serial_numbers SET work_order_id = (
        SELECT sm.work_order_id FROM serial_movements sm
        WHERE sm.serial_id = serial_numbers.id AND sm.work_order_id IS NOT NULL
        ORDER BY sm.id DESC LIMIT 1
      ) WHERE work_order_id IS NULL`],
  ];
  const backfilled = {};
  for (const [table, sql] of backfills) {
    try {
      const r = db.prepare(sql).run();
      if (r.changes) backfilled[table] = r.changes;
    } catch (_error) { /* 表不存在 */ }
  }
  return { added, backfilled };
}

module.exports = { ensureChainSchema, SOFT_LINKS, INDEXES };
