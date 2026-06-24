const Database = require('better-sqlite3');
const db = new Database('/home/dubin/factory-mes/data/mes.db', { readonly: true });
// parent_id = 134 (总装) 的节点 = 二层（subsystem 主部件）
const lvl2 = db.prepare(`SELECT id, operation_name, subsystem_id FROM process_nodes WHERE parent_id = 134 ORDER BY subsystem_id, sequence`).all();
console.log('=== parent=#134 (总装子节点, level 2) ===');
console.log('count:', lvl2.length);
lvl2.forEach(n => console.log(`  #${n.id} sub=${n.subsystem_id} "${n.operation_name}"`));
// 这些 level 2 的子节点 = level 3（叶子）
console.log('=== 这些节点的子节点 (level 3) ===');
const stmt = db.prepare(`SELECT id, operation_name, parent_id, subsystem_id FROM process_nodes WHERE equipment_instance_id = 1 AND id IN (
  SELECT id FROM process_nodes WHERE parent_id IN (
    SELECT id FROM process_nodes WHERE parent_id = 134 AND equipment_instance_id = 1
  ) AND equipment_instance_id = 1
) ORDER BY parent_id, sequence`);
const lvl3 = stmt.all();
console.log('count:', lvl3.length);
lvl3.slice(0, 20).forEach(n => console.log(`  #${n.id} parent=${n.parent_id} sub=${n.subsystem_id} "${n.operation_name}"`));
if (lvl3.length > 20) console.log(`  ... +${lvl3.length - 20} more`);
// 每个 subsystem 下有多少个 level-2 主部件？
console.log('=== 每个 subsystem 的 level-2 节点数 ===');
const dist = {};
lvl2.forEach(n => { dist[n.subsystem_id] = (dist[n.subsystem_id] || 0) + 1; });
console.log(JSON.stringify(dist, null, 2));
