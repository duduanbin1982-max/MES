"use strict";

function collectQualityExceptions({ ctx, instanceById, items, pushException }) {
  if (ctx.tableExists("qc_ncr")) {
    const rows = ctx.safeAll(`
      SELECT * FROM qc_ncr
      WHERE COALESCE(status, '') NOT IN ('closed', 'resolved')
      ORDER BY id DESC
      LIMIT 100
    `);
    for (const row of rows) {
      const instanceId = row.equipment_instance_id || row.instance_id || null;
      const instance = instanceById.get(Number(instanceId)) || {};
      pushException(items, {
        id: `qc_ncr_${row.id}`,
        type: "quality_ncr",
        severity: row.severity || "high",
        title: row.ncr_no ? `NCR ${row.ncr_no}` : `质量不合格 ${row.id}`,
        message: row.title || row.description || "质量问题待处置",
        instance_id: instanceId,
        instance_code: instance.instance_code,
        created_at: row.created_at,
        source: "qc_ncr",
        source_path: "/quality",
        action_label: "处置 NCR",
      });
    }
  }

  if (ctx.tableExists("ncr_reports")) {
    const rows = ctx.safeAll(`
      SELECT n.*, ei.instance_code,
        CASE
          WHEN n.closed_at IS NOT NULL THEN 'closed'
          WHEN n.disposition IS NOT NULL AND n.disposition != 'pending' THEN 'disposed'
          ELSE 'open'
        END AS ncr_status,
        (
          SELECT COUNT(*) FROM capa_actions c
          WHERE c.ncr_id = n.id AND COALESCE(c.status, '') != 'closed'
        ) AS open_capa_count,
        (
          SELECT COUNT(*) FROM ncr_rechecks r
          WHERE r.ncr_id = n.id AND r.result = 'fail'
        ) AS failed_recheck_count
      FROM ncr_reports n
      LEFT JOIN equipment_instances ei ON ei.id = n.equipment_instance_id
      WHERE n.closed_at IS NULL
      ORDER BY
        CASE n.severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 ELSE 3 END,
        n.created_at DESC
      LIMIT 200
    `);
    for (const row of rows) {
      const severity = row.severity === "critical" ? "critical" : row.severity === "major" ? "high" : "warning";
      const step = row.ncr_status === "open"
        ? "待处置"
        : Number(row.open_capa_count || 0) > 0
          ? `CAPA未完成 ${row.open_capa_count}`
          : Number(row.failed_recheck_count || 0) > 0
            ? "复检失败"
            : "待复检/关闭";
      pushException(items, {
        id: `ncr_${row.id}`,
        type: "quality_ncr",
        severity,
        title: `NCR ${row.ncr_code || row.id}`,
        message: `${row.instance_code || "-"} ${row.part_name || "部件"}：${row.defect_desc || "质量问题"}（${step}）`,
        instance_id: row.equipment_instance_id,
        instance_code: row.instance_code,
        created_at: row.created_at,
        source: "ncr_reports",
        source_path: "/quality",
        action_label: "处理 NCR",
      });
    }
  }
}

module.exports = { collectQualityExceptions };
