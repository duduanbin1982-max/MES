const Database = require('better-sqlite3');
const db = new Database('/home/dubin/factory-mes/data/mes.db', { readonly: true });
// 看 #135 (盾体 subsystem 第一个 parent=134 的节点) 的详细
console.log('=== #135 详情 ===');
console.log(JSON.stringify(db.prepare('SELECT * FROM process_nodes WHERE id = 135').get(), null, 2));
// parent=134 且 subsystem=2 的（主驱动子节点）有哪些？
console.log('=== parent=134 AND subsystem=2 (主驱动) ===');
db.prepare('SELECT id, operation_name, sequence, bom_node_id FROM process_nodes WHERE parent_id = 134 AND subsystem_id = 2 ORDER BY sequence').all().forEach(n => console.log(`  #${n.id} seq=${n.sequence} bom=${n.bom_node_id} "${n.operation_name}"`));
// 看 bom_node_id 指向什么 — 是不是 BOM 表的零件
console.log('\n=== bom_node_id 对照 instance_bom ===');
const boms = db.prepare(`SELECT id, parent_id, material_id, level FROM instance_bom WHERE equipment_instance_id = 1 ORDER BY level, id`).all();
console.log('bom levels:', [...new Set(boms.map(b => b.level))]);
console.log('count by level:', JSON.stringify(boms.reduce((m,b)=>{m[b.level]=(m[b.level]||0)+1;return m;},{})));
