const Database = require('better-sqlite3')
const db = new Database('/home/dubin/factory-mes/data/mes.db')

// 拿所有 instance=1 的节点，按 BOM 关系 join 物料名
const rows = db.prepare(`
  SELECT n.id, n.operation_name, n.operation_type, m.material_name
  FROM process_nodes n
  LEFT JOIN instance_bom b ON b.id = n.bom_node_id
  LEFT JOIN materials m ON m.id = b.material_id
  WHERE n.equipment_instance_id = 1
  ORDER BY n.parent_id NULLS FIRST, n.sequence
`).all()

// 按物料聚合看分类线索
const byMaterial = {}
for (const r of rows) {
  const key = r.material_name || '(no material)'
  if (!byMaterial[key]) byMaterial[key] = []
  byMaterial[key].push(r.operation_name)
}

console.log('=== 物料 + 操作聚类 ===')
for (const [mat, ops] of Object.entries(byMaterial)) {
  console.log(`[${mat}] (${ops.length} nodes)`)
  const uniqOps = [...new Set(ops)]
  for (const op of uniqOps.slice(0, 5)) console.log(`    - ${op}`)
  if (uniqOps.length > 5) console.log(`    ... +${uniqOps.length - 5} more`)
}
