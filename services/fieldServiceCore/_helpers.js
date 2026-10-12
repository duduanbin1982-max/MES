"use strict";
// 快模式按主题拆分（原 services/fieldServiceCore.js）

function helpers(db) {
  return {
    all: (sql, params = []) => db.prepare(sql).all(...params),
    get: (sql, params = []) => db.prepare(sql).get(...params),
    run: (sql, params = []) => db.prepare(sql).run(...params),
    tx: (fn) => db.transaction(fn),
    db,
  };
}

function upsertMaintenancePlanSpares(db, planId, spareParts) {
  if (spareParts === undefined) return;
  db.prepare("DELETE FROM maintenance_spare_parts WHERE plan_id = ?").run(planId);
  if (!Array.isArray(spareParts) || !spareParts.length) return;
  const insert = db.prepare("INSERT OR IGNORE INTO maintenance_spare_parts (plan_id, spare_part_id, quantity) VALUES (?, ?, ?)");
  for (const sparePart of spareParts) {
    insert.run(planId, sparePart.spare_part_id, sparePart.quantity || 1);
  }
}

module.exports = { helpers, upsertMaintenancePlanSpares };
