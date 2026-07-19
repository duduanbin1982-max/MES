"use strict";

const { wrap } = require("../../middleware/asyncHandler");

function registerDashboardRoutes({ app, helpers }) {
  const { all, get } = helpers;

  app.get("/api/qc/dashboard", wrap((_req, res) => {
    const ncrOpen = get("SELECT COUNT(*) c FROM ncr_reports WHERE closed_at IS NULL")?.c || 0;
    const ncrResolved30d = get("SELECT COUNT(*) c FROM ncr_reports WHERE closed_at >= datetime('now', '-30 days')")?.c || 0;
    const capaOpen = get("SELECT COUNT(*) c FROM capa_actions WHERE status != 'closed'")?.c || 0;
    const capaOverdue = get("SELECT COUNT(*) c FROM capa_actions WHERE due_date < datetime('now') AND status != 'closed'")?.c || 0;
    const inspectionCount = get("SELECT COUNT(*) c FROM qc_inspections WHERE inspection_date >= datetime('now', '-30 days')")?.c || 0;
    const passCount = get("SELECT COUNT(*) c FROM qc_inspections WHERE inspection_date >= datetime('now', '-30 days') AND result='pass'")?.c || 0;
    const passRate30d = inspectionCount ? Math.round(passCount * 100 / inspectionCount) : 0;
    const defectTop5 = all("SELECT defect_desc, COUNT(*) as count FROM ncr_reports GROUP BY defect_desc ORDER BY count DESC LIMIT 5");
    res.json({
      ncr_open: ncrOpen,
      ncr_resolved_30d: ncrResolved30d,
      capa_open: capaOpen,
      capa_overdue: capaOverdue,
      pass_rate_30d: passRate30d,
      defect_top5: defectTop5.map((defect) => ({ defect_type: defect.defect_desc, count: defect.count })),
    });
  }));
}

module.exports = { registerDashboardRoutes };
