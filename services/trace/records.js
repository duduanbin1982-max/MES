"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");

function ensureTraceSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS serial_numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_no TEXT NOT NULL UNIQUE,
      lot_id INTEGER REFERENCES material_lots(id),
      equipment_instance_id INTEGER REFERENCES equipment_instances(id),
      status TEXT DEFAULT 'in_stock',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS serial_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_id INTEGER,
      lot_id INTEGER,
      work_order_id INTEGER,
      equipment_instance_id INTEGER,
      movement_type TEXT,
      quantity REAL DEFAULT 1,
      moved_by INTEGER,
      moved_at TEXT DEFAULT (datetime('now')),
      notes TEXT
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_serial_instance ON serial_numbers(equipment_instance_id, status);
    CREATE INDEX IF NOT EXISTS idx_serial_movements_serial ON serial_movements(serial_id, moved_at);
    CREATE INDEX IF NOT EXISTS idx_assembly_work_order ON assembly_records(work_order_id, step_no);
    CREATE INDEX IF NOT EXISTS idx_ndt_work_order ON ndt_records(work_order_id, weld_record_id);
  `);
}

function actorId(req) {
  return req.user?.sub || req.user?.uid || req.user?.id || null;
}

function registerTraceRecordRoutes(app, db) {
  ensureTraceSchema(db);

  app.get("/api/trace/context", wrap((req, res) => {
    const instanceId = Number(req.query.instance_id);
    if (!instanceId) throw ApiError.validation("instance_id 必填");
    if (!db.prepare("SELECT id FROM equipment_instances WHERE id=?").get(instanceId)) throw ApiError.notFound("设备实例不存在");
    const workOrders = db.prepare("SELECT id, wo_code, title, status FROM work_orders WHERE equipment_instance_id=? ORDER BY id DESC").all(instanceId);
    const lots = db.prepare(`
      SELECT DISTINCT ml.id, ml.lot_no, m.material_code, m.material_name, ml.quality_status
      FROM material_lots ml
      JOIN materials m ON m.id=ml.material_id
      LEFT JOIN material_movements mm ON mm.material_lot_id=ml.id
      LEFT JOIN work_orders wo ON wo.id=mm.work_order_id
      WHERE wo.equipment_instance_id=? OR EXISTS (
        SELECT 1 FROM serial_numbers sn WHERE sn.lot_id=ml.id AND sn.equipment_instance_id=?
      )
      ORDER BY ml.id DESC
    `).all(instanceId, instanceId);
    const welds = db.prepare(`
      SELECT wr.id, wr.work_order_id, wr.weld_no, wr.inspection_result, wo.wo_code
      FROM weld_records wr JOIN work_orders wo ON wo.id=wr.work_order_id
      WHERE wo.equipment_instance_id=? ORDER BY wr.id DESC
    `).all(instanceId);
    const users = db.prepare("SELECT id, username, full_name FROM users WHERE is_active=1 ORDER BY full_name, username").all();
    res.json({ work_orders: workOrders, lots, welds, users });
  }));

  app.get("/api/trace/records", wrap((req, res) => {
    const instanceId = Number(req.query.instance_id);
    if (!instanceId) throw ApiError.validation("instance_id 必填");
    const equipment = db.prepare("SELECT id, instance_code, instance_name FROM equipment_instances WHERE id=?").get(instanceId);
    if (!equipment) throw ApiError.notFound("设备实例不存在");
    const serials = db.prepare(`
      SELECT sn.*, ml.lot_no, m.material_code, m.material_name
      FROM serial_numbers sn
      LEFT JOIN material_lots ml ON ml.id=sn.lot_id
      LEFT JOIN materials m ON m.id=ml.material_id
      WHERE sn.equipment_instance_id=? ORDER BY sn.id DESC
    `).all(instanceId);
    const assemblies = db.prepare(`
      SELECT ar.*, wo.wo_code, wo.title AS work_order_title, u.full_name AS operator_name
      FROM assembly_records ar
      JOIN work_orders wo ON wo.id=ar.work_order_id
      LEFT JOIN users u ON u.id=ar.operator_id
      WHERE wo.equipment_instance_id=? ORDER BY ar.assembly_date DESC, ar.id DESC
    `).all(instanceId);
    const ndt = db.prepare(`
      SELECT nr.*, wo.wo_code, wr.weld_no, u.full_name AS inspector_name
      FROM ndt_records nr
      JOIN work_orders wo ON wo.id=nr.work_order_id
      LEFT JOIN weld_records wr ON wr.id=nr.weld_record_id
      LEFT JOIN users u ON u.id=nr.inspector_id
      WHERE wo.equipment_instance_id=? ORDER BY nr.inspection_date DESC, nr.id DESC
    `).all(instanceId);
    res.json({ equipment, serials, assemblies, ndt });
  }));

  app.post("/api/trace/serials", wrap((req, res) => {
    const body = req.body || {};
    if (!body.serial_no || !body.lot_id || !body.equipment_instance_id) {
      throw ApiError.validation("serial_no / lot_id / equipment_instance_id 必填");
    }
    const lot = db.prepare("SELECT id FROM material_lots WHERE id=?").get(body.lot_id);
    if (!lot) throw ApiError.notFound("物料批次不存在");
    const equipment = db.prepare("SELECT id FROM equipment_instances WHERE id=?").get(body.equipment_instance_id);
    if (!equipment) throw ApiError.notFound("设备实例不存在");
    const transaction = db.transaction(() => {
      const created = db.prepare(`INSERT INTO serial_numbers
        (serial_no, lot_id, equipment_instance_id, status, notes)
        VALUES (?, ?, ?, 'in_stock', ?)`)
        .run(String(body.serial_no).trim(), body.lot_id, body.equipment_instance_id, body.notes || null);
      db.prepare(`INSERT INTO serial_movements
        (serial_id, lot_id, equipment_instance_id, movement_type, moved_by, notes)
        VALUES (?, ?, ?, 'register', ?, ?)`)
        .run(created.lastInsertRowid, body.lot_id, body.equipment_instance_id, actorId(req), body.notes || "序列号建档");
      return Number(created.lastInsertRowid);
    });
    res.status(201).json(db.prepare("SELECT * FROM serial_numbers WHERE id=?").get(transaction()));
  }));

  app.post("/api/trace/serials/:id/movements", wrap((req, res) => {
    const body = req.body || {};
    const allowed = ["issue", "assemble", "remove", "return", "scrap"];
    if (!allowed.includes(body.movement_type)) throw ApiError.validation("movement_type 非法");
    const serial = db.prepare("SELECT * FROM serial_numbers WHERE id=?").get(req.params.id);
    if (!serial) throw ApiError.notFound("序列号不存在");
    let workOrder;
    if (body.work_order_id) {
      workOrder = db.prepare("SELECT id, equipment_instance_id FROM work_orders WHERE id=?").get(body.work_order_id);
      if (!workOrder) throw ApiError.notFound("工单不存在");
      if (Number(workOrder.equipment_instance_id) !== Number(serial.equipment_instance_id)) throw ApiError.validation("工单与序列号所属设备不一致");
    }
    const statusMap = { issue: "issued", assemble: "assembled", remove: "removed", return: "in_stock", scrap: "scrapped" };
    const transaction = db.transaction(() => {
      const result = db.prepare(`INSERT INTO serial_movements
        (serial_id, lot_id, work_order_id, equipment_instance_id, movement_type, quantity, moved_by, notes)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(serial.id, serial.lot_id, body.work_order_id || null, serial.equipment_instance_id, body.movement_type, actorId(req), body.notes || null);
      db.prepare("UPDATE serial_numbers SET status=? WHERE id=?").run(statusMap[body.movement_type], serial.id);
      return Number(result.lastInsertRowid);
    });
    res.status(201).json({ id: transaction(), serial_id: serial.id, status: statusMap[body.movement_type] });
  }));

  app.post("/api/trace/assembly-records", wrap((req, res) => {
    const body = req.body || {};
    if (!body.work_order_id || !Number.isInteger(Number(body.step_no)) || !body.step_name) {
      throw ApiError.validation("work_order_id / step_no / step_name 必填");
    }
    if (!db.prepare("SELECT id FROM work_orders WHERE id=?").get(body.work_order_id)) throw ApiError.notFound("工单不存在");
    const result = db.prepare(`INSERT INTO assembly_records
      (work_order_id, step_no, step_name, operator_id, torque_value_nm, clearance_mm, photos, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(body.work_order_id, Number(body.step_no), body.step_name, body.operator_id || actorId(req), body.torque_value_nm ?? null,
        body.clearance_mm ?? null, body.photos ? JSON.stringify(body.photos) : null, body.notes || null);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  }));

  app.post("/api/trace/ndt-records", wrap((req, res) => {
    const body = req.body || {};
    if (!body.work_order_id || !body.weld_record_id || !body.ndt_method || !["pass", "fail"].includes(body.result)) {
      throw ApiError.validation("work_order_id / weld_record_id / ndt_method / result(pass|fail) 必填");
    }
    const weld = db.prepare("SELECT id, work_order_id FROM weld_records WHERE id=?").get(body.weld_record_id);
    if (!weld) throw ApiError.notFound("焊缝记录不存在");
    if (Number(weld.work_order_id) !== Number(body.work_order_id)) throw ApiError.validation("焊缝记录与工单不一致");
    if (body.report_file) throw ApiError.validation("NDT 报告附件须通过文档管理上传并关联，禁止仅填虚拟路径");
    const result = db.prepare(`INSERT INTO ndt_records
      (work_order_id, weld_record_id, ndt_method, ndt_grade, result, inspector_id, report_no, inspection_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`)
      .run(body.work_order_id, body.weld_record_id, body.ndt_method, body.ndt_grade || null, body.result,
        body.inspector_id || actorId(req), body.report_no || null, body.inspection_date || null, body.notes || null);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  }));
}

module.exports = { ensureTraceSchema, registerTraceRecordRoutes };
