"use strict";
// 2026-11-10 设备台账拆分：车间生产设备台账（equipment + 工位 + IoT）
// 注意：项目装备实例（equipment_instances）已迁到 /project-equipment-ledger，不再混用。

const STATUSES = ["running", "idle", "maintenance", "fault", "offline", "retired"];
const CRITICALITIES = ["A", "B", "C"];
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

function registerLedgerRoutes({ app, wrap, all, get, run, ApiError }) {
  const typeLabel = (value) => EQUIPMENT_TYPES.find((item) => item.value === value)?.label || value || "-";

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
      responsible_user_id: body.responsible_user_id == null || body.responsible_user_id === "" ? null : Number(body.responsible_user_id),
      notes: String(body.notes || "").trim() || null,
      last_maintenance: body.last_maintenance || null,
    };
  }

  function validate(body) {
    if (!body.code) throw ApiError.validation("设备编码必填");
    if (!body.name) throw ApiError.validation("设备名称必填");
    if (!STATUSES.includes(body.status)) throw ApiError.validation("设备状态不合法");
    if (!CRITICALITIES.includes(body.criticality)) throw ApiError.validation("关键度必须是 A/B/C");
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
           (SELECT COUNT(*) FROM iot_devices d WHERE d.equipment_id = e.id) AS iot_count,
           (SELECT COUNT(*) FROM iot_devices d WHERE d.equipment_id = e.id AND d.status = 'online') AS iot_online,
           (SELECT MAX(d.last_seen_at) FROM iot_devices d WHERE d.equipment_id = e.id) AS iot_last_seen
      FROM equipment e
      LEFT JOIN workstations w ON w.id = e.workstation_id
     WHERE 1=1`;

  app.get("/api/equipment-ledger/meta", wrap((_req, res) => {
    const types = all("SELECT DISTINCT equipment_type FROM equipment WHERE equipment_type IS NOT NULL").map((row) => row.equipment_type);
    res.json({
      statuses: STATUSES.map((value) => ({ value, label: ({ running: "运行", idle: "空闲", maintenance: "维保", fault: "故障", offline: "离线", retired: "退役" })[value] })),
      criticalities: CRITICALITIES,
      types: types.map((value) => ({ value, label: typeLabel(value) })),
      workstations: all("SELECT id, code, name, workshop, station_type, status FROM workstations WHERE is_active = 1 ORDER BY workshop, code"),
    });
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
    if (String(req.query.include_retired || "true") === "false") where.push("e.status != 'retired'");
    const rows = all(`${selectSql}${where.length ? " AND " + where.join(" AND ") : ""} ORDER BY e.code`, ...params);
    const summary = {
      total: rows.length,
      running: rows.filter((row) => row.status === "running").length,
      idle: rows.filter((row) => row.status === "idle").length,
      maintenance: rows.filter((row) => row.status === "maintenance").length,
      fault: rows.filter((row) => row.status === "fault").length,
      offline: rows.filter((row) => row.status === "offline").length,
      retired: rows.filter((row) => row.status === "retired").length,
      iot_online: rows.filter((row) => Number(row.iot_online) > 0).length,
      iot_total: rows.reduce((sum, row) => sum + Number(row.iot_count || 0), 0),
    };
    res.json({ equipment: rows, summary });
  }));

  app.get("/api/equipment-ledger/:id", wrap((req, res) => {
    const row = get(`${selectSql} AND e.id = ?`, req.params.id);
    if (!row) throw ApiError.notFound("设备不存在");
    res.json(row);
  }));

  app.post("/api/equipment-ledger", wrap((req, res) => {
    const body = normalizeBody(req.body);
    validate(body);
    if (get("SELECT id FROM equipment WHERE code = ?", body.code)) throw ApiError.validation("设备编码已存在");
    const result = run(`INSERT INTO equipment (
      code, name, equipment_type, workstation_id, status, asset_no, manufacturer, model, serial_no,
      location, criticality, purchase_date, warranty_end, responsible_user_id, notes, last_maintenance, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      body.code, body.name, body.equipment_type, body.workstation_id, body.status, body.asset_no,
      body.manufacturer, body.model, body.serial_no, body.location, body.criticality,
      body.purchase_date, body.warranty_end, body.responsible_user_id, body.notes, body.last_maintenance);
    res.status(201).json(get(`${selectSql} AND e.id = ?`, Number(result.lastInsertRowid)));
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
      warranty_end = ?, responsible_user_id = ?, notes = ?, last_maintenance = ?, updated_at = datetime('now')
      WHERE id = ?`,
      body.code, body.name, body.equipment_type, body.workstation_id, body.status, body.asset_no,
      body.manufacturer, body.model, body.serial_no, body.location, body.criticality,
      body.purchase_date, body.warranty_end, body.responsible_user_id, body.notes, body.last_maintenance,
      req.params.id);
    res.json(get(`${selectSql} AND e.id = ?`, req.params.id));
  }));

  app.post("/api/equipment-ledger/:id/status", wrap((req, res) => {
    const status = String(req.body?.status || "").trim();
    if (!STATUSES.includes(status)) throw ApiError.validation("设备状态不合法");
    const existing = get("SELECT id FROM equipment WHERE id = ?", req.params.id);
    if (!existing) throw ApiError.notFound("设备不存在");
    run("UPDATE equipment SET status = ?, updated_at = datetime('now') WHERE id = ?", status, req.params.id);
    res.json(get(`${selectSql} AND e.id = ?`, req.params.id));
  }));

  app.delete("/api/equipment-ledger/:id", wrap((req, res) => {
    const existing = get("SELECT id FROM equipment WHERE id = ?", req.params.id);
    if (!existing) throw ApiError.notFound("设备不存在");
    const iotCount = get("SELECT COUNT(*) AS c FROM iot_devices WHERE equipment_id = ?", req.params.id)?.c || 0;
    if (Number(iotCount) > 0) throw ApiError.validation("设备存在关联 IoT 采集点，请先解绑后再删除");
    run("DELETE FROM equipment WHERE id = ?", req.params.id);
    res.json({ ok: true, changes: 1 });
  }));
}

module.exports = { registerLedgerRoutes, STATUSES, EQUIPMENT_TYPES };
