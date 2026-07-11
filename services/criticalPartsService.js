// services/criticalPartsService.js
// 关键件管理 —— 监造 + 证书 + 追溯 统一聚合
"use strict";

const { wrap } = require("../middleware/asyncHandler");

function register(app, db) {
  const { get, all, run } = require("../routes/_helpers")(db);

  app.get("/api/critical-parts/dashboard", wrap((req, res) => {
    const instanceId = req.query.instance_id ? Number(req.query.instance_id) : null;

    // 关键件清单 (from key_components + critical_parts)
    const parts = all(`
      SELECT kc.id, kc.component_type, m.material_name, m.material_code,
        kc.supplier, kc.supplier_part_no, kc.lead_time_weeks, kc.unit_price, kc.risk_level,
        cp.part_code, cp.drawing_no, cp.spec, cp.manufacturing_standard, cp.inspection_points,
        cp.status AS critical_status,
        (SELECT COUNT(*) FROM critical_part_certificates cpc WHERE cpc.part_id = kc.id) AS cert_count,
        (SELECT COUNT(*) FROM supervision_logs sl WHERE sl.part_id = kc.id) AS supervision_count,
        ei.instance_name
      FROM key_components kc
      LEFT JOIN materials m ON m.id = kc.material_id
      LEFT JOIN critical_parts cp ON cp.id = kc.id
      LEFT JOIN equipment_instances ei ON ei.id = cp.equipment_instance_id
      WHERE (? IS NULL OR cp.equipment_instance_id = ? OR cp.equipment_instance_id IS NULL)
      ORDER BY CASE kc.risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, kc.id
    `, [instanceId, instanceId]);

    // 证书
    const certs = all(`
      SELECT cpc.*, kc.component_type, kc.supplier
      FROM critical_part_certificates cpc
      LEFT JOIN key_components kc ON kc.id = cpc.part_id
      ORDER BY cpc.issue_date DESC
    `);

    // 监造日志
    const logs = all(`
      SELECT sl.*, ei.instance_name, kc.component_type
      FROM supervision_logs sl
      LEFT JOIN equipment_instances ei ON ei.id = sl.equipment_instance_id
      LEFT JOIN key_components kc ON kc.id = sl.part_id
      ORDER BY sl.log_date DESC
    `);

    // 验收清单
    const checklists = all(`
      SELECT ac.*, ei.instance_name
      FROM acceptance_checklists ac
      LEFT JOIN equipment_instances ei ON ei.id = ac.equipment_instance_id
      ORDER BY ac.created_at DESC
    `);

    // 装备列表
    const instances = all("SELECT id, instance_code, instance_name FROM equipment_instances");

    res.json({
      parts,
      certs,
      logs,
      checklists,
      instances,
      overview: {
        total_parts: parts.length,
        high_risk: parts.filter(p => p.risk_level === "high").length,
        total_certs: certs.length,
        total_logs: logs.length,
        pending_checklists: checklists.filter(c => c.status === "pending").length,
      }
    });
  }));

  // 上传证书
  app.post("/api/critical-parts/:id/cert", wrap((req, res) => {
    const body = req.body || {};
    const result = run(
      "INSERT INTO critical_part_certificates (part_id, cert_type, cert_no, issued_by, issue_date, expiry_date, file_path) VALUES (?,?,?,?,?,?,?)",
      [Number(req.params.id), body.cert_type, body.cert_no||null, body.issued_by||null, body.issue_date||null, body.expiry_date||null, body.file_path||null]
    );
    res.status(201).json({ id: result.lastInsertRowid, created: true });
  }));

  // 添监造日志
  app.post("/api/critical-parts/supervision", wrap((req, res) => {
    const body = req.body || {};
    const result = run(
      "INSERT INTO supervision_logs (equipment_instance_id, part_id, log_date, inspector, location, content, issues, status) VALUES (?,?,?,?,?,?,?,?)",
      [body.equipment_instance_id||null, body.part_id||null, body.log_date||null, body.inspector||null, body.location||null, body.content||null, body.issues||null, body.status||"normal"]
    );
    res.status(201).json({ id: result.lastInsertRowid, created: true });
  }));

  console.log("[criticalParts] Registered");
}

module.exports = { register };
