const Database = require('better-sqlite3');
const db = new Database('/home/dubin/factory-mes/data/mes.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%subsystem%'").all();
console.log('subsystem tables:', JSON.stringify(tables));
const cols = db.prepare('PRAGMA table_info(process_nodes)').all();
const subCols = cols.filter(c => c.name.toLowerCase().includes('subsystem'));
console.log('process_nodes subsystem cols:', JSON.stringify(subCols));
console.log('all process_nodes cols:', cols.map(c => c.name).join(', '));

// 看实际数据
const subDist = db.prepare("SELECT subsystem_id, COUNT(*) as cnt FROM process_nodes WHERE equipment_instance_id=1 GROUP BY subsystem_id").all();
console.log('instance=1 subsystem_id 分布:', JSON.stringify(subDist));

// 看 phase_code 分布
const phaseDist = db.prepare("SELECT phase_code, COUNT(*) as cnt FROM process_nodes WHERE equipment_instance_id=1 GROUP BY phase_code").all();
console.log('instance=1 phase_code 分布:', JSON.stringify(phaseDist));

// 看是否有 subsystems 表本身
const subTbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name='subsystems' OR name='equipment_subsystems' OR name='phases')").all();
console.log('subsystems/phases tables:', JSON.stringify(subTbl));

// 看 equipment_instances schema
const instCols = db.prepare('PRAGMA table_info(equipment_instances)').all();
console.log('equipment_instances cols:', instCols.map(c => c.name).join(', '));
