const Database = require('better-sqlite3');
const db = new Database('/home/dubin/factory-mes/data/mes.db', { readonly: true });
// 看 subsystem=7 (液压) parent=134 的所有节点，bom_node_id 不同就是不同零件
console.log('=== subsystem=7, parent=134 — 液压子系统所有节点 ===');
db.prepare(`SELECT id, operation_name, bom_node_id, sequence, material_name, notes FROM process_nodes WHERE parent_id = 134 AND subsystem_id = 7 ORDER BY bom_node_id, sequence LIMIT 30`).all().forEach(n => console.log(`  #${n.id} bom=${n.bom_node_id} seq=${n.sequence} "${n.operation_name}" mat="${n.material_name||''}"`));
// 同一 bom_node_id 是不是只有一种 operation_name？
console.log('\n=== bom_node_id=19 (主驱动某零件) 的所有节点 ===');
db.prepare(`SELECT id, operation_name, sequence, subsystem_id FROM process_nodes WHERE equipment_instance_id = 1 AND bom_node_id = 19 ORDER BY sequence`).all().forEach(n => console.log(`  #${n.id} sub=${n.subsystem_id} seq=${n.sequence} "${n.operation_name}"`));
// process_nodes 有 material_name 字段吗？看 schema
console.log('\n=== process_nodes columns ===');
db.prepare(`PRAGMA table_info(process_nodes)`).all().forEach(c => console.log(`  ${c.name} ${c.type}`));
