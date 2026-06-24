const Database = require('better-sqlite3');
// 2026-06-22：从根目录移到 scripts/debug/ 后，相对路径会失效；改用绝对路径
const db = new Database('/home/dubin/factory-mes/data/mes.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tables.map(t => t.name).join(', '));
const counts = ['customers', 'suppliers', 'projects', 'main_structures', 'parts', 'bom', 'critical_components', 'operations'];
for (const t of counts) {
  try {
    const c = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get();
    console.log(`  ${t}: ${c.c} rows`);
  } catch (e) {
    console.log(`  ${t}: ERROR ${e.message}`);
  }
}
