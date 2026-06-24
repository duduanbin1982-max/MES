const Database = require('better-sqlite3');
const db = new Database('/home/dubin/factory-mes/data/mes.db', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
for (const t of tables) {
  console.log('==' + t.name + '==');
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  cols.forEach(c => console.log('  ' + c.name + ' ' + c.type));
}
