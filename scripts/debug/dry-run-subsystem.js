const Database = require('better-sqlite3')
const { classifyBatch, RULES } = require('./services/process/subsystemClassifier.js')

const db = new Database('/home/dubin/factory-mes/data/mes.db')

// 拿所有 instance=1 的节点 + 物料名
const rows = db.prepare(`
  SELECT n.id, n.parent_id, n.operation_name, m.material_name
  FROM process_nodes n
  LEFT JOIN instance_bom b ON b.id = n.bom_node_id
  LEFT JOIN materials m ON m.id = b.material_id
  WHERE n.equipment_instance_id = 1
`).all()

const { assignments, summary } = classifyBatch(rows)

// 1. 各 subsystem 计数
console.log('=== 分类汇总 (instance=1) ===')
console.log(`总节点: ${rows.length}`)
const subNames = {1:'刀盘', 2:'主驱动', 3:'盾体', 4:'推进系统', 5:'拼装系统', 6:'出渣系统', 7:'液压系统', 8:'电气控制', 9:'后配套'}
for (const rule of RULES) {
  if (summary[rule.id]) {
    const cnt = summary[rule.id]
    console.log(`  ${rule.id}. ${rule.name}: ${cnt} 节点`)
  }
}
const unmatched = assignments.filter(a => a.subsystem_id == null)
console.log(`  未分类: ${unmatched.length} 节点`)

// 2. 未分类的节点（看哪些规则漏了）
console.log('\n=== 未分类节点 ===')
const uniqUnmatched = {}
for (const u of unmatched) {
  const key = u.unmatched_material || '(no material)'
  if (!uniqUnmatched[key]) uniqUnmatched[key] = []
  uniqUnmatched[key].push(u.unmatched_op)
}
for (const [mat, ops] of Object.entries(uniqUnmatched)) {
  console.log(`  [${mat}]`)
  for (const op of [...new Set(ops)]) console.log(`    - ${op}`)
}

// 3. 抽样看几个分类示例
console.log('\n=== 分类示例（前 20）===')
for (let i = 0; i < Math.min(20, assignments.length); i++) {
  const a = assignments[i]
  const r = rows.find(x => x.id === a.id)
  const sub = a.subsystem_id ? subNames[a.subsystem_id] : '未分类'
  console.log(`  #${a.id} [${sub}] mat="${r.material_name || ''}" op="${r.operation_name}"`)
}
