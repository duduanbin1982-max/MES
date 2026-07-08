const { wrap } = require('../../middleware/asyncHandler');
// services/processProgress.js
// 批次 3 重构：从 server.js 抽出

// db.js 提供 db 实例；本文件用闭包包裹工具函数
const all = (db, sql, params = []) => db.prepare(sql).all(params);
const get = (db, sql, params = []) => db.prepare(sql).get(params);
const run = (db, sql, params = []) => db.prepare(sql).run(params);


function getProcessProgress(req, res, db) {
  const instanceId = req.params.id;
  const stats = all(db, 
    "SELECT operation_type, status, count(*) c FROM process_nodes WHERE equipment_instance_id = ? GROUP BY operation_type, status",
    instanceId
  );
  const byStatus = { pending: 0, ready: 0, in_progress: 0, completed: 0, blocked: 0, paused: 0 };
  const byType = {};
  let total = 0, completed = 0;
  stats.forEach((s) => {
    byStatus[s.status] = (byStatus[s.status] || 0) + s.c;
    byType[s.operation_type] = (byType[s.operation_type] || 0) + s.c;
    total += s.c;
    if (s.status === 'completed') completed += s.c;
  });
  const progressPct = total ? Math.round(completed * 100 / total) : 0;

  // 估时 vs 实际
  const hours = get(db, 
    "SELECT COALESCE(SUM(estimated_hours), 0) est, " +
    "(SELECT COALESCE(SUM(hours_worked), 0) FROM process_executions pe JOIN process_nodes pn ON pe.process_node_id = pn.id WHERE pn.equipment_instance_id = ?) act " +
    "FROM process_nodes WHERE equipment_instance_id = ?",
    [instanceId, instanceId]
  );

  // 按 phase (S1-S10)
  const byPhase = all(db, 
    "SELECT phase_code, count(*) total, sum(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed FROM process_nodes WHERE equipment_instance_id = ? AND phase_code IS NOT NULL GROUP BY phase_code ORDER BY phase_code",
    instanceId
  );

  res.json({
    instance_id: instanceId,
    total_nodes: total,
    completed_nodes: completed,
    progress_pct: progressPct,
    by_status: byStatus,
    by_type: byType,
    by_phase: byPhase.map(p => ({ ...p, pct: p.total ? Math.round(p.completed * 100 / p.total) : 0 })),
    hours: { estimated: hours?.est || 0, actual: hours?.act || 0, efficiency: hours?.est ? Math.round((hours.est / hours.act) * 100) : 0 }
  });
}

module.exports = { getProcessProgress };
