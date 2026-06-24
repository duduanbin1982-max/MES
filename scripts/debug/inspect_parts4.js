const Database = require('better-sqlite3');
const db = new Database('/home/dubin/factory-mes/data/mes.db', { readonly: true });
// 看 instance_bom level 2 的 9 个（subsystem 主部件）
console.log('=== instance_bom level=2 (subsystem 主部件) ===');
const lvl2 = db.prepare(`SELECT b.id, b.parent_id, b.material_id, b.level, b.quantity, m.material_code, m.material_name FROM instance_bom b LEFT JOIN materials m ON b.material_id = m.id WHERE b.equipment_instance_id = 1 AND b.level = 2 ORDER BY b.sequence, b.id`).all();
lvl2.forEach(b => console.log(`  bom#${b.id} parent=${b.parent_id} lvl=${b.level} qty=${b.quantity} "${b.material_code}" / "${b.material_name}"`));
// level 3 的前 20 个（主部件下的零件）
console.log('\n=== instance_bom level=3 (零件) 前 20 ===');
db.prepare(`SELECT b.id, b.parent_id, b.material_id, m.material_code, m.material_name FROM instance_bom b LEFT JOIN materials m ON b.material_id = m.id WHERE b.equipment_instance_id = 1 AND b.level = 3 ORDER BY b.parent_id, b.id LIMIT 20`).all().forEach(b => console.log(`  bom#${b.id} parent=${b.parent_id} "${b.material_name}"`));
// materials 表有多少物料？
console.log('\n=== materials 总数 ===', db.prepare('SELECT COUNT(*) c FROM materials').get());
// instance_bom 关联 process_nodes 吗？看 bom_node_id 字段
console.log('\n=== process_nodes.bom_node_id 分布 ===');
const dist = db.prepare('SELECT bom_node_id, COUNT(*) c FROM process_nodes WHERE equipment_instance_id = 1 GROUP BY bom_node_id ORDER BY c DESC LIMIT 10').all();
dist.forEach(d => console.log(`  bom=${d.bom_node_id}: ${d.c} process_nodes`));
