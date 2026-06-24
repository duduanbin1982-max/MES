const D=require('better-sqlite3');
const db=new D('/home/dubin/factory-mes/data/mes.db',{readonly:true});
db.prepare('PRAGMA table_info(process_nodes)').all().forEach(c => console.log(c.name, c.type));
