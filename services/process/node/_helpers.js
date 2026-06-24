"use strict";
// services/process/node/_helpers.js
// 共享 db helpers + autoUnlockSuccessors (依赖前驱节点解锁)
// Author: 三狗子 | Date: 2026-06-24

const all = (db, sql, params = []) => db.prepare(sql).all(params);
const get = (db, sql, params = []) => db.prepare(sql).get(params);
const run = (db, sql, params = []) => db.prepare(sql).run(params);
const wrap = (handler) => (req, res) => {
  try { handler(req, res); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
};

// 当某节点完成时, 检查它的所有后继节点: 若所有前驱都 completed, 把 pending -> ready
function autoUnlockSuccessors(db, nodeId, equipmentInstanceId) {
  const succs = all(db, 'SELECT successor_id FROM process_dependencies WHERE predecessor_id = ?', nodeId);
  for (const dep of succs) {
    const succId = dep.successor_id;
    const allPreds = all(db, 'SELECT predecessor_id FROM process_dependencies WHERE successor_id = ?', succId);
    if (allPreds.length === 0) continue;
    let allDone = true;
    for (const p of allPreds) {
      const st = get(db, 'SELECT status FROM process_nodes WHERE id = ?', p.predecessor_id);
      if (!st || st.status !== 'completed') { allDone = false; break; }
    }
    if (allDone) {
      const succ = get(db, 'SELECT status FROM process_nodes WHERE id = ?', succId);
      if (succ && succ.status === 'pending') {
        run(db, "UPDATE process_nodes SET status = 'ready', updated_at = datetime('now') WHERE id = ?", succId);
      }
    }
  }
}

module.exports = {
  all, get, run, wrap,
  autoUnlockSuccessors,
};
