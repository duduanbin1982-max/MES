/**
 * Migration: backfill subsystem_id on process_nodes
 *
 * 一次性跑（idempotent — 已分类的节点不会重复更新）
 * 用 classifier 规则推断每个节点的 subsystem_id
 *
 * 用法：
 *   DRY_RUN=1 node migrate-backfill-subsystem.js   ← 只看不写
 *   node migrate-backfill-subsystem.js             ← 实际写库
 */

const Database = require('better-sqlite3')
const { classifyBatch } = require('./subsystemClassifier.js')

const DB_PATH = '/home/dubin/factory-mes/data/mes.db'
const DRY_RUN = process.env.DRY_RUN === '1'

const db = new Database(DB_PATH)

// 拿所有 process_nodes + 物料名
const rows = db.prepare(`
  SELECT n.id, n.parent_id, n.operation_name, m.material_name, n.subsystem_id as current
  FROM process_nodes n
  LEFT JOIN instance_bom b ON b.id = n.bom_node_id
  LEFT JOIN materials m ON m.id = b.material_id
`).all()

console.log(`总节点: ${rows.length}`)
console.log(`已分类: ${rows.filter(r => r.current != null).length}`)
console.log(`未分类: ${rows.filter(r => r.current == null).length}`)

// 分类
const { assignments, summary } = classifyBatch(rows)

// 只更新「当前是 null 且新分类不为 null」的节点
const updates = []
for (const a of assignments) {
  const r = rows.find(x => x.id === a.id)
  if (a.subsystem_id != null && r.current == null) {
    updates.push({ id: a.id, new: a.subsystem_id, old: r.current, mat: r.material_name, op: r.operation_name })
  }
}

console.log(`\n待更新: ${updates.length}`)
console.log('\n=== 前 20 条预览 ===')
for (const u of updates.slice(0, 20)) {
  console.log(`  #${u.id} ${u.mat || '(no mat)'} / ${u.op} → subsystem_id=${u.new}`)
}

if (DRY_RUN) {
  console.log('\n[DRY_RUN] 不写库')
  process.exit(0)
}

// 实际写库（在事务里）
const updateStmt = db.prepare('UPDATE process_nodes SET subsystem_id = ?, updated_at = datetime(\'now\') WHERE id = ? AND subsystem_id IS NULL')
const tx = db.transaction((rows) => {
  let n = 0
  for (const r of rows) {
    const info = updateStmt.run(r.new, r.id)
    if (info.changes) n++
  }
  return n
})

const changed = tx(updates)
console.log(`\n✅ 实际更新行数: ${changed}`)

// 验证
const afterNull = db.prepare("SELECT COUNT(*) as c FROM process_nodes WHERE subsystem_id IS NULL").get()
const afterDist = db.prepare("SELECT subsystem_id, COUNT(*) as c FROM process_nodes GROUP BY subsystem_id ORDER BY subsystem_id").all()
console.log(`\n更新后 null 节点: ${afterNull.c}`)
console.log('更新后分布:')
for (const d of afterDist) {
  console.log(`  subsystem_id=${d.subsystem_id}: ${d.c}`)
}
