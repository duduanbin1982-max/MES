const Database = require('better-sqlite3');
const db = new Database('/home/dubin/factory-mes/data/mes.db', { readonly: true });
const roots = db.prepare(`SELECT id, operation_name, parent_id, subsystem_id FROM process_nodes WHERE equipment_instance_id = 1 AND parent_id IS NULL ORDER BY subsystem_id, id`).all();
console.log('roots count:', roots.length);
roots.forEach(r => console.log(`  #${r.id} sub=${r.subsystem_id} "${r.operation_name}"`));
const all = db.prepare(`SELECT id, parent_id FROM process_nodes WHERE equipment_instance_id = 1`).all();
const byId = new Map(all.map(n => [n.id, n]));
const depth = (id, seen) => {
  if (seen.has(id)) return 0;
  seen.add(id);
  const n = byId.get(id);
  if (!n || !n.parent_id) return 1;
  return 1 + depth(n.parent_id, seen);
};
const dist = {};
all.forEach(n => {
  const d = depth(n.id, new Set());
  dist[d] = (dist[d] || 0) + 1;
});
console.log('depth dist:', JSON.stringify(dist));
