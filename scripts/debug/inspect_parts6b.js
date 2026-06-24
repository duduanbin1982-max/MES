const Database = require('better-sqlite3');
const db = new Database('/home/dubin/factory-mes/data/mes.db', { readonly: true });
// 看 subsystem=7 (液压) parent=134 的所有节点
const r = db.prepare(`SELECT id, operation_name, bom_node_id, sequence FROM process_nodes WHERE parent_id = 134 AND subsystem_id = 7 ORDER BY bom_node_id, sequence LIMIT 30`).all();
console.log('液压 subsystem=7, parent=134 count:', r.length);
r.forEach(n => console.log(`  #${n.id} bom=${n.bom_node_id} seq=${n.sequence} "${n.operation_name}"`));
// bom_node_id=19 的所有节点
console.log('\nbom_node_id=19 count:');
const r2 = db.prepare(`SELECT id, operation_name, sequence, subsystem_id FROM process_nodes WHERE equipment_instance_id = 1 AND bom_node_id = 19 ORDER BY sequence`).all();
r2.forEach(n => console.log(`  #${n.id} sub=${n.subsystem_id} seq=${n.sequence} "${n.operation_name}"`));
