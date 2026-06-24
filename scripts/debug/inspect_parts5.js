const Database = require('better-sqlite3');
const db = new Database('/home/dubin/factory-mes/data/mes.db', { readonly: true });
console.log('total bom rows:', db.prepare('SELECT COUNT(*) c FROM instance_bom WHERE equipment_instance_id = 1').get());
console.log('total bom rows ALL:', db.prepare('SELECT COUNT(*) c FROM instance_bom').get());
console.log('materials total:', db.prepare('SELECT COUNT(*) c FROM materials').get());
console.log('--- sample bom ---');
db.prepare('SELECT * FROM instance_bom LIMIT 5').all().forEach(r => console.log(JSON.stringify(r)));
