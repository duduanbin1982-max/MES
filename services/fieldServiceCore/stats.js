"use strict";
// 快模式按主题拆分（原 services/fieldServiceCore.js）
const { helpers } = require("./_helpers");

function maintenancePlanStats(db) {
  const { get } = helpers(db);
  const count = (sql) => get(sql)?.c || 0;
  return {
    total: count("SELECT COUNT(*) c FROM maintenance_plans"),
    pending: count("SELECT COUNT(*) c FROM maintenance_plans WHERE status = 'pending'"),
    in_progress: count("SELECT COUNT(*) c FROM maintenance_plans WHERE status = 'in_progress'"),
    completed: count("SELECT COUNT(*) c FROM maintenance_plans WHERE status = 'completed'"),
    overdue: count("SELECT COUNT(*) c FROM maintenance_plans WHERE next_due_date < date('now') AND status != 'completed'"),
  };
}

module.exports = { maintenancePlanStats };
