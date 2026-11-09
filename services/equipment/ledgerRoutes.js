"use strict";
// 2026-11-10 设备台账第二阶段：车间生产设备 + 维保 + OEE + 状态履历
// 项目装备实例在 /project-equipment-ledger，不与本模块混用。

const STATUSES = ["running", "idle", "maintenance", "fault", "offline", "retired"];
const STATUS_LABELS = { running: "运行", idle: "空闲", maintenance: "维保", fault: "故障", offline: "离线", retired: "退役" };
const CRITICALITIES = ["A", "B", "C"];
const DEPRECIATION_METHODS = ["straight_line", "double_declining", "none"];
const MAINTENANCE_TYPES = ["periodic", "preventive", "predictive", "corrective", "inspection"];
const EQUIPMENT_TYPES = [
  { value: "laser_cutter", label: "激光切割机" },
  { value: "press_brake", label: "折弯机" },
  { value: "welder", label: "焊机" },
  { value: "weld_robot", label: "焊接机器人" },
  { value: "boring", label: "镗床" },
  { value: "crane", label: "行车" },
  { value: "test_rig", label: "试压平台" },
  { value: "cnc", label: "数控机床" },
  { value: "other", label: "其他" },
];

function registerLedgerRoutes({ app, wrap, all: allRaw, get: getRaw, run: runRaw, ApiError }) {
  const all = (sql, ...params) => allRaw(sql, params);
  const get = (sql, ...params) => getRaw(sql, params);
  const run = (sql, ...params) => runRaw(sql, params);
  const typeLabel = (value) => EQUIPMENT_TYPES.find((item) => item.value === value)?.label || value || "-";
  const today = () => new Date().toISOString().slice(0, 10);

  function normalizeBody(body = {}) {
    return {
      id: body.id == null ? null : Number(body.id),
      code: String(body.code || "").trim(),
      name: String(body.name || "").trim(),
      equipment_type: String(body.equipment_type || "other").trim(),
      workstation_id: body.workstation_id == null || body.workstation_id === "" ? null : Number(body.workstation_id),
      status: String(body.status || "idle").trim(),
      asset_no: String(body.asset_no || "").trim() || null,
      manufacturer: String(body.manufacturer || "").trim() || null,
      model: String(body.model || "").trim() || null,
      serial_no: String(body.serial_no || "").trim() || null,
      location: String(body.location || "").trim() || null,
      criticality: String(body.criticality || "B").trim().toUpperCase(),
      purchase_date: body.purchase_date || null,
      warranty_end: body.warranty_end || null,
      commission_date: body.commission_date || null,
      responsible_user_id: body.responsible_user_id == null || body.responsible_user_id === "" ? null : Number(body.responsible_user_id),
      original_value: body.original_value == null || body.original_value === "" ? null : Number(body.original_value),
      depreciation_method: String(body.depreciation_method || "straight_line").trim(),
      depreciation_years: body.depreciation_years == null || body.depreciation_years === "" ? null : Number(body.depreciation_years),
      residual_rate: body.residual_rate == null || body.residual_rate === "" ? 0 : Number(body.residual_rate),
      notes: String(body.notes || "").trim() || null,
      last_maintenance: body.last_maintenance || null,
    };
  }

  function validate(body) {
    if (!body.code) throw ApiError.validation("设备编码必填");
    if (!body.name) throw ApiError.validation("设备名称必填");
    if (!STATUSES.includes(body.status)) throw ApiError.validation("设备状态不合法");
    if (!CRITICALITIES.includes(body.criticality)) throw ApiError.validation("关键度必须是 A/B/C");
    if (!DEPRECIATION_METHODS.includes(body.depreciation_method)) throw ApiError.validation("折旧方式不合法");
    if (body.depreciation_years != null && body.depreciation_years <= 0) throw ApiError.validation("折旧年限必须大于 0");
    if (body.residual_rate != null && (body.residual_rate < 0 || body.residual_rate > 1)) throw ApiError.validation("残值率必须在 0~1 之间");
    if (body.workstation_id != null && !get("SELECT id FROM workstations WHERE id = ?", body.workstation_id)) {
      throw ApiError.validation("工位不存在");
    }
    if (body.asset_no) {
      const duplicate = get("SELECT id FROM equipment WHERE asset_no = ? AND id != ?", body.asset_no, body.id || 0);
      if (duplicate) throw ApiError.validation("资产编号已存在");
    }
  }

  const selectSql = `
    SELECT e.*, w.code AS workstation_code, w.name AS workstation_name,
           w.workshop AS workshop, w.station_type AS station_type,
           (SELECT COUNT(*) FROM iot_devices d WHERE d.production_equipment_id = e.id) AS iot_count,
           (SELECT COUNT(*) FROM iot_devices d WHERE d.production_equipment_id = e.id AND d.status = 'online') AS iot_online,
           (SELECT MAX(d.last_seen_at) FROM iot_devices d WHERE d.production_equipment_id = e.id) AS iot_last_seen,
           (SELECT MIN(p.next_due_date) FROM equipment_maintenance_plans p WHERE p.equipment_id = e.id AND p.status = 'active') AS next_maintenance_date,
           (SELECT COUNT(*) FROM equipment_maintenance_plans p WHERE p.equipment_id = e.id AND p.status = 'active' AND p.next_due_date <= date('now')) AS overdue_maintenance_count,
           (SELECT COUNT(*) FROM equipment_maintenance_logs l WHERE l.equipment_id = e.id) AS maintenance_log_count
      FROM equipment e
      LEFT JOIN workstations w ON w.id = e.workstation_id
     WHERE 1=1`;

  function getEquipment(id) {
    return get(`${selectSql} AND e.id = ?`, id);
  }

  app.get("/api/equipment-ledger/meta", wrap((_req, res) => {
    const types = all("SELECT DISTINCT equipment_type FROM equipment WHERE equipment_type IS NOT NULL").map((row) => row.equipment_type);
    res.json({
      statuses: STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
      criticalities: CRITICALITIES,
      depreciation_methods: DEPRECIATION_METHODS.map((value) => ({ value, label: ({ straight_line: "直线法", double_declining: "双倍余额递减", none: "不折旧" })[value] })),
      maintenance_types: MAINTENANCE_TYPES.map((value) => ({ value, label: ({ periodic: "定期", preventive: "预防性", predictive: "预测性", corrective: "事后维修", inspection: "点检" })[value] })),
      types: types.map((value) => ({ value, label: typeLabel(value) })),
      workstations: all("SELECT id, code, name, workshop, station_type, status FROM workstations WHERE is_active = 1 ORDER BY workshop, code"),
    });
  }));

  app.get("/api/equipment-ledger/maintenance/due", wrap((req, res) => {
    const days = Math.max(1, Math.min(Number(req.query.days) || 30, 365));
    const rows = all(`
      SELECT p.*, e.code, e.name, e.status AS equipment_status,
             CAST(julianday(p.next_due_date) - julianday(date('now')) AS INTEGER) AS days_left
        FROM equipment_maintenance_plans p
        JOIN equipment e ON e.id = p.equipment_id
       WHERE p.status = 'active' AND p.next_due_date IS NOT NULL
         AND p.next_due_date <= date('now', ?)
       ORDER BY p.next_due_date`,
      `+${days} days`);
    res.json({ items: rows, days });
  }));

  app.get("/api/equipment-ledger", wrap((req, res) => {
    const where = [];
    const params = [];
    const keyword = String(req.query.keyword || "").trim();
    if (keyword) {
      where.push("(e.code LIKE ? OR e.name LIKE ? OR COALESCE(e.asset_no,'') LIKE ? OR COALESCE(e.model,'') LIKE ? OR COALESCE(e.serial_no,'') LIKE ? OR COALESCE(e.manufacturer,'') LIKE ?)");
      const like = `%${keyword}%`;
      params.push(like, like, like, like, like, like);
    }
    if (req.query.equipment_type) { where.push("e.equipment_type = ?"); params.push(String(req.query.equipment_type)); }
    if (req.query.status) { where.push("e.status = ?"); params.push(String(req.query.status)); }
    if (req.query.workshop_id) { where.push("e.workstation_id = ?"); params.push(Number(req.query.workshop_id)); }
    if (req.query.workshop) { where.push("w.workshop = ?"); params.push(String(req.query.workshop)); }
    if (String(req.query.include_retired || "true") === "false") where.push("e.status != 'retired'");
    const whereSql = where.length ? " AND " + where.join(" AND ") : "";
    const totalRow = get(`SELECT COUNT(*) AS c FROM equipment e LEFT JOIN workstations w ON w.id = e.workstation_id WHERE 1=1${whereSql}`, ...params);
    const filteredTotal = Number(totalRow?.c || 0);
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 20, 200));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rows = all(`${selectSql}${whereSql} ORDER BY e.code LIMIT ? OFFSET ?`, ...params, limit, offset);
    const allRows = all(`${selectSql}${whereSql} ORDER BY e.code`, ...params);
    const summary = {
      total: filteredTotal,
      running: allRows.filter((row) => row.status === "running").length,
      idle: allRows.filter((row) => row.status === "idle").length,
      maintenance: allRows.filter((row) => row.status === "maintenance").length,
      fault: allRows.filter((row) => row.status === "fault").length,
      offline: allRows.filter((row) => row.status === "offline").length,
      retired: allRows.filter((row) => row.status === "retired").length,
      iot_online: allRows.filter((row) => Number(row.iot_online) > 0).length,
      iot_total: allRows.reduce((sum, row) => sum + Number(row.iot_count || 0), 0),
      maintenance_due: allRows.filter((row) => Number(row.overdue_maintenance_count) > 0).length,
    };
    res.json({ equipment: rows, summary, pagination: { total: filteredTotal, limit, offset } });
  }));

  app.get("/api/equipment-ledger/:id", wrap((req, res) => {
    const row = getEquipment(req.params.id);
    if (!row) throw ApiError.notFound("设备不存在");
    row.iot_devices = all("SELECT id, device_code, device_name, device_type, status, last_seen_at, manufacturer, model, location FROM iot_devices WHERE production_equipment_id = ? ORDER BY id", req.params.id);
    res.json(row);
  }));

  app.post("/api/equipment-ledger", wrap((req, res) => {
    const body = normalizeBody(req.body);
    validate(body);
    if (get("SELECT id FROM equipment WHERE code = ?", body.code)) throw ApiError.validation("设备编码已存在");
    const result = run(`INSERT INTO equipment (
      code, name, equipment_type, workstation_id, status, asset_no, manufacturer, model, serial_no,
      location, criticality, purchase_date, warranty_end, commission_date, responsible_user_id,
      original_value, depreciation_method, depreciation_years, residual_rate, notes, last_maintenance, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      body.code, body.name, body.equipment_type, body.workstation_id, body.status, body.asset_no,
      body.manufacturer, body.model, body.serial_no, body.location, body.criticality,
      body.purchase_date, body.warranty_end, body.commission_date, body.responsible_user_id,
      body.original_value, body.depreciation_method, body.depreciation_years, body.residual_rate,
      body.notes, body.last_maintenance);
    const id = Number(result.lastInsertRowid);
    run("INSERT INTO equipment_status_logs (equipment_id, from_status, to_status, reason) VALUES (?, NULL, ?, '新增设备')", id, body.status);
    res.status(201).json(getEquipment(id));
  }));

  app.put("/api/equipment-ledger/:id", wrap((req, res) => {
    const existing = get("SELECT * FROM equipment WHERE id = ?", req.params.id);
    if (!existing) throw ApiError.notFound("设备不存在");
    const body = normalizeBody({ ...existing, ...req.body, id: Number(req.params.id) });
    validate(body);
    if (get("SELECT id FROM equipment WHERE code = ? AND id != ?", body.code, req.params.id)) throw ApiError.validation("设备编码已存在");
    run(`UPDATE equipment SET
      code = ?, name = ?, equipment_type = ?, workstation_id = ?, status = ?, asset_no = ?,
      manufacturer = ?, model = ?, serial_no = ?, location = ?, criticality = ?, purchase_date = ?,
      warranty_end = ?, commission_date = ?, responsible_user_id = ?, original_value = ?, depreciation_method = ?,
      depreciation_years = ?, residual_rate = ?, notes = ?, last_maintenance = ?, updated_at = datetime('now')
      WHERE id = ?`,
      body.code, body.name, body.equipment_type, body.workstation_id, body.status, body.asset_no,
      body.manufacturer, body.model, body.serial_no, body.location, body.criticality,
      body.purchase_date, body.warranty_end, body.commission_date, body.responsible_user_id,
      body.original_value, body.depreciation_method, body.depreciation_years, body.residual_rate,
      body.notes, body.last_maintenance, req.params.id);
    if (existing.status !== body.status) {
      run("INSERT INTO equipment_status_logs (equipment_id, from_status, to_status, reason) VALUES (?, ?, ?, '编辑设备')", req.params.id, existing.status, body.status);
    }
    res.json(getEquipment(req.params.id));
  }));

  app.post("/api/equipment-ledger/:id/status", wrap((req, res) => {
    const status = String(req.body?.status || "").trim();
    if (!STATUSES.includes(status)) throw ApiError.validation("设备状态不合法");
    const existing = get("SELECT id, status FROM equipment WHERE id = ?", req.params.id);
    if (!existing) throw ApiError.notFound("设备不存在");
    if (existing.status !== status) {
      run("UPDATE equipment SET status = ?, updated_at = datetime('now') WHERE id = ?", status, req.params.id);
      run("INSERT INTO equipment_status_logs (equipment_id, from_status, to_status, reason, changed_by) VALUES (?, ?, ?, ?, ?)",
        req.params.id, existing.status, status, req.body?.reason || null, req.user?.uid || req.user?.id || null);
    }
    res.json(getEquipment(req.params.id));
  }));

  app.get("/api/equipment-ledger/:id/status-logs", wrap((req, res) => {
    res.json(all("SELECT * FROM equipment_status_logs WHERE equipment_id = ? ORDER BY changed_at DESC, id DESC LIMIT 100", req.params.id));
  }));

  // ===== 维保 =====
  app.get("/api/equipment-ledger/:id/maintenance", wrap((req, res) => {
    const plans = all("SELECT * FROM equipment_maintenance_plans WHERE equipment_id = ? ORDER BY COALESCE(next_due_date, '9999-12-31'), id", req.params.id);
    const logs = all("SELECT * FROM equipment_maintenance_logs WHERE equipment_id = ? ORDER BY performed_at DESC, id DESC LIMIT 50", req.params.id);
    const due = plans.filter((plan) => plan.status === "active" && plan.next_due_date && plan.next_due_date <= today());
    res.json({ plans, logs, summary: { plan_count: plans.length, due_count: due.length, log_count: logs.length } });
  }));

  app.post("/api/equipment-ledger/:id/maintenance/plans", wrap((req, res) => {
    const equipment = get("SELECT id, code FROM equipment WHERE id = ?", req.params.id);
    if (!equipment) throw ApiError.notFound("设备不存在");
    const planName = String(req.body?.plan_name || "").trim();
    if (!planName) throw ApiError.validation("维保计划名称必填");
    const type = String(req.body?.maintenance_type || "periodic");
    if (!MAINTENANCE_TYPES.includes(type)) throw ApiError.validation("维保类型不合法");
    const frequency = req.body?.frequency_days == null ? null : Number(req.body.frequency_days);
    const nextDue = req.body?.next_due_date || (frequency ? today() : null);
    const code = String(req.body?.plan_code || "").trim() || `MP-${equipment.code}-${Date.now().toString().slice(-6)}`;
    const result = run(`INSERT INTO equipment_maintenance_plans
      (equipment_id, plan_code, plan_name, maintenance_type, frequency_days, next_due_date, status, assigned_to, notes)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      req.params.id, code, planName, type, frequency, nextDue, req.body?.assigned_to || null, req.body?.notes || null);
    res.status(201).json(get("SELECT * FROM equipment_maintenance_plans WHERE id = ?", Number(result.lastInsertRowid)));
  }));

  app.post("/api/equipment-ledger/:id/maintenance/logs", wrap((req, res) => {
    const equipment = get("SELECT id FROM equipment WHERE id = ?", req.params.id);
    if (!equipment) throw ApiError.notFound("设备不存在");
    const performedAt = req.body?.performed_at || today();
    const planId = req.body?.plan_id == null ? null : Number(req.body.plan_id);
    const result = run(`INSERT INTO equipment_maintenance_logs
      (equipment_id, plan_id, performed_by, performed_at, hours_spent, findings, actions_taken, parts_replaced, next_due_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.params.id, planId, req.body?.performed_by || null, performedAt,
      req.body?.hours_spent == null ? null : Number(req.body.hours_spent),
      req.body?.findings || null, req.body?.actions_taken || null, req.body?.parts_replaced || null,
      req.body?.next_due_at || null, req.body?.status || "completed");
    if (planId) {
      const nextDue = req.body?.next_due_at || null;
      run("UPDATE equipment_maintenance_plans SET last_done_date = ?, next_due_date = COALESCE(?, next_due_date), updated_at = datetime('now') WHERE id = ?", performedAt, nextDue, planId);
    }
    run("UPDATE equipment SET last_maintenance = ?, updated_at = datetime('now') WHERE id = ?", performedAt, req.params.id);
    res.status(201).json(get("SELECT * FROM equipment_maintenance_logs WHERE id = ?", Number(result.lastInsertRowid)));
  }));

  // ===== OEE =====
  app.get("/api/equipment-ledger/:id/oee", wrap((req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 30, 180));
    const rows = all("SELECT * FROM equipment_oee_shift_log WHERE equipment_id = ? ORDER BY shift_date DESC, id DESC LIMIT ?", req.params.id, limit);
    const planned = rows.reduce((sum, row) => sum + Number(row.planned_minutes || 0), 0);
    const operating = rows.reduce((sum, row) => sum + Number(row.operating_minutes || 0), 0);
    const totalOutput = rows.reduce((sum, row) => sum + Number(row.total_output || 0), 0);
    const goodOutput = rows.reduce((sum, row) => sum + Number(row.good_output || 0), 0);
    const idealOutput = rows.reduce((sum, row) => sum + Number(row.total_output || 0) * Number(row.ideal_cycle_time || 0), 0);
    const availability = planned > 0 ? operating * 100 / planned : 0;
    const performance = operating > 0 ? idealOutput * 100 / operating : 0;
    const quality = totalOutput > 0 ? goodOutput * 100 / totalOutput : 0;
    const oee = availability * performance * quality / 10000;
    res.json({
      rows,
      summary: {
        shifts: rows.length,
        availability: Number(availability.toFixed(1)),
        performance: Number(performance.toFixed(1)),
        quality: Number(quality.toFixed(1)),
        oee: Number(oee.toFixed(1)),
      },
    });
  }));

  app.post("/api/equipment-ledger/:id/oee", wrap((req, res) => {
    const equipment = get("SELECT id FROM equipment WHERE id = ?", req.params.id);
    if (!equipment) throw ApiError.notFound("设备不存在");
    const shiftDate = String(req.body?.shift_date || "").trim();
    if (!shiftDate) throw ApiError.validation("班次日期必填");
    const result = run(`INSERT INTO equipment_oee_shift_log
      (equipment_id, shift_date, shift_name, planned_minutes, operating_minutes, ideal_cycle_time, total_output, good_output, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.params.id, shiftDate, req.body?.shift_name || null,
      Number(req.body?.planned_minutes || 0), Number(req.body?.operating_minutes || 0),
      Number(req.body?.ideal_cycle_time || 0), Number(req.body?.total_output || 0),
      Number(req.body?.good_output || 0), req.body?.source || "manual", req.body?.notes || null);
    res.status(201).json(get("SELECT * FROM equipment_oee_shift_log WHERE id = ?", Number(result.lastInsertRowid)));
  }));

  // 软删除：退役并保留履历
  function retireEquipment(req, res) {
    const existing = get("SELECT id, status FROM equipment WHERE id = ?", req.params.id);
    if (!existing) throw ApiError.notFound("设备不存在");
    if (existing.status !== "retired") {
      run("UPDATE equipment SET status = 'retired', retired_at = datetime('now'), retire_reason = ?, updated_at = datetime('now') WHERE id = ?", req.body?.reason || "设备退役", req.params.id);
      run("INSERT INTO equipment_status_logs (equipment_id, from_status, to_status, reason) VALUES (?, ?, 'retired', ?)", req.params.id, existing.status, req.body?.reason || "设备退役");
    }
    res.json({ ok: true, retired: true, item: getEquipment(req.params.id) });
  }
  app.post("/api/equipment-ledger/:id/retire", wrap(retireEquipment));
  app.delete("/api/equipment-ledger/:id", wrap(retireEquipment));
}

module.exports = { registerLedgerRoutes, STATUSES, EQUIPMENT_TYPES };
