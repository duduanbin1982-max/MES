const D=require('better-sqlite3');
const db=new D('/home/dubin/factory-mes/data/mes.db',{readonly:true});
const cols = db.prepare('PRAGMA table_info(process_nodes)').all();
const ic = cols.filter(c => /crit/i.test(c.name));
console.log('crit-related cols:', ic.map(c => c.name));
const im = cols.filter(c => /milestone/i.test(c.name));
console.log('milestone cols:', im.map(c => c.name));
// 看一个 root node 的所有列
console.log('root node (#134) row:');
console.log(JSON.stringify(db.prepare('SELECT * FROM process_nodes WHERE id = 134').get(), null, 2));
