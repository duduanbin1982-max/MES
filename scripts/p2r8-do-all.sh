#!/bin/bash
set -e
cd /home/dubin/factory-mes
echo "=== P2-#8 do-all start: $(date) ==="

# 步骤 1: 写 migration 012
echo "--- 1) migration 012 ---"
cat > db/migrations/012_process_params.sql <<'SQL_EOF'
-- 012_process_params.sql (P2-#8 工艺参数记录)
CREATE TABLE IF NOT EXISTS process_params (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_node_id INTEGER NOT NULL,
  recorded_by INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  current_amp REAL,
  voltage_v REAL,
  speed_mm_min REAL,
  temperature_c REAL,
  pressure_mpa REAL,
  feed_rate REAL,
  custom_json TEXT,
  notes TEXT,
  FOREIGN KEY (process_node_id) REFERENCES process_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pp_node_time ON process_params(process_node_id, recorded_at);
SELECT '012 done' as status;
SQL_EOF
node migrate.js 2>&1 | tail -3

# 步骤 2: 写 Node 脚本改 server.js（比 sed 稳）
echo "--- 2) Node 脚本改 server.js ---"
cat > /tmp/p2r8-patch.js <<'JS_EOF'
const fs = require('fs');
const path = '/home/dubin/factory-mes/server.js';
let c = fs.readFileSync(path, 'utf8');

// 找 /api/process_nodes/:id/efficiency 行号
const lines = c.split('\n');
let targetLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("'/api/process_nodes/:id/efficiency'")) {
    targetLine = i;
    break;
  }
}
if (targetLine < 0) { console.error('efficiency route not found'); process.exit(1); }
console.log('efficiency 在 line', targetLine + 1);

// 找到该行后第一个 })); 关闭
let closeLine = -1;
for (let i = targetLine; i < lines.length; i++) {
  if (lines[i].trim() === '}));') { closeLine = i; break; }
}
if (closeLine < 0) { console.error('closing })); not found'); process.exit(1); }
console.log('closing })); 在 line', closeLine + 1);

const block = [
  '',
  '// P2-#8 工艺参数记录',
  "app.get('/api/process_nodes/:id/params', wrap((req, res) => {",
  "  res.json(all('SELECT pp.*, u.full_name as recorder_name FROM process_params pp LEFT JOIN users u ON pp.recorded_by = u.id WHERE process_node_id = ? ORDER BY recorded_at DESC', req.params.id));",
  '}));',
  '',
  "app.post('/api/process_nodes/:id/params', wrap((req, res) => {",
  '  const { current_amp, voltage_v, speed_mm_min, temperature_c, pressure_mpa, feed_rate, custom_json, notes, recorded_by } = req.body;',
  '  const r = run("INSERT INTO process_params (process_node_id, current_amp, voltage_v, speed_mm_min, temperature_c, pressure_mpa, feed_rate, custom_json, notes, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",',
  "    [req.params.id, current_amp||null, voltage_v||null, speed_mm_min||null, temperature_c||null, pressure_mpa||null, feed_rate||null, custom_json||null, notes||null, recorded_by||null]);",
  "  res.json({ id: r.lastInsertRowid });",
  '}));'
];

lines.splice(closeLine + 1, 0, ...block);
fs.writeFileSync(path, lines.join('\n'));
console.log('插入', block.length, '行 in line', closeLine + 2);
JS_EOF
node /tmp/p2r8-patch.js

# 步骤 3: 语法 + 重启
echo "--- 3) syntax check + restart ---"
node --check server.js && echo "SYNTAX OK"
systemctl --user restart factory-mes.service
sleep 2

# 步骤 4: 验证
echo "--- 4) verify ---"
TOKEN=$(curl -s -X POST http://127.0.0.1:3890/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
NODE_ID=$(node -e "const D=require('./node_modules/better-sqlite3'); console.log(new D('./data/mes.db',{readonly:true}).prepare('SELECT id FROM process_nodes WHERE equipment_instance_id=1 LIMIT 1').get().id);")
echo "NODE_ID=$NODE_ID"
echo "--- POST 1 条测试参数 ---"
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"current_amp\":220,\"voltage_v\":28,\"speed_mm_min\":450,\"temperature_c\":85,\"recorded_by\":4,\"notes\":\"P2-#8 test\"}" "http://127.0.0.1:3890/api/process_nodes/$NODE_ID/params"
echo ""
echo "--- GET 列表 ---"
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3890/api/process_nodes/$NODE_ID/params" | head -c 500
echo ""
echo "=== P2-#8 do-all done: $(date) ==="
