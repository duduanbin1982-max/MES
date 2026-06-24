// migrate.js - 执行 migrations
const fs = require('fs');
const path = require('path');
const db = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, 'db', 'migrations');

// 创建迁移追踪表
db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT UNIQUE NOT NULL,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

const files = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

console.log(`Found ${files.length} migration file(s)`);

for (const file of files) {
  const executed = db.prepare('SELECT 1 FROM _migrations WHERE filename = ?').get(file);
  if (executed) {
    console.log(`✓ ${file} (already executed)`);
    continue;
  }

  console.log(`→ Running ${file}...`);
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

  // SQLite 不支持多语句中包含 INSERT OR IGNORE 时使用事务（exec 不支持事务）
  // 这里使用 db.exec 一次执行整个文件
  try {
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file);
    console.log(`✓ ${file} done`);
  } catch (err) {
    console.error(`✗ ${file} failed:`, err.message);
    process.exit(1);
  }
}

console.log('\nMigrations complete.');
process.exit(0);