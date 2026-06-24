/**
 * 工艺节点 → 子系统分类（纯函数，无 DB 依赖）
 *
 * 规则（按 material_name 关键词 + operation_name 兜底）：
 * - 关键词匹配顺序从上到下，命中即返回
 * - 所有规则都不命中 → null（未分类，归到"其他"组）
 *
 * subsystem_id 对照 equipment_subsystems 表：
 *   1=刀盘 / 2=主驱动 / 3=盾体 / 4=推进系统 / 5=拼装系统
 *   6=出渣系统 / 7=液压系统 / 8=电气控制 / 9=后配套
 */

// 规则表（顺序敏感：先匹配先生效）
// 每条规则 = { id, keywords: [在 material_name 或 operation_name 中搜索的关键词] }
const RULES = [
  { id: 1, name: '刀盘',         keywords: ['盘形滚刀', '刮刀', '滚刀', '刀盘', '刀具', '刀座'] },
  { id: 2, name: '主驱动',       keywords: ['主轴承', '行星减速机', '变频电机 75kW', '主驱动'] },
  { id: 3, name: '盾体',         keywords: ['Q345', '16Mn', '低合金钢板', '卷制', '焊接', 'UT 探伤', '盾体', '拼焊'] },
  { id: 4, name: '推进系统',     keywords: ['推进油缸', '推进液压', '推进系统'] },
  { id: 5, name: '拼装系统',     keywords: ['管片拼装机', '拼装'] },
  { id: 6, name: '出渣系统',     keywords: ['螺旋输送机', '出渣', '螺旋', '皮带机'] },
  { id: 7, name: '液压系统',     keywords: ['液压', '油箱', '阀组', '高压油管', '铰接油缸', '铰接密封', '主密封', '尾刷密封', '密封'] },
  { id: 8, name: '电气控制',     keywords: ['PLC', '变频器', '配电柜', '电缆', '传感器', '控制', 'ABB', '西门子'] },
  { id: 9, name: '后配套',       keywords: ['拖车底盘', '操作室', '通风机', '后配套'] },
  { id: 3, name: '盾体',         keywords: ['人舱门'] }  // 人舱门是盾体前部壳体一部分
] 

/**
 * 单节点分类
 * @param {{material_name?: string, operation_name?: string}} node
 * @returns {number|null} subsystem_id（无匹配返回 null）
 */
function classifyNode(node) {
  const hay = ((node.material_name || '') + ' ' + (node.operation_name || '')).toLowerCase()
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (hay.includes(kw.toLowerCase())) return rule.id
    }
  }
  return null
}

/**
 * 批量分类（带统计）
 * @param {Array<{id, material_name?, operation_name?}>} nodes
 * @returns {{assignments: Array<{id, subsystem_id, rule_name?}>, summary: Object<id, count>}}
 */
function classifyBatch(nodes) {
  const assignments = []
  const summary = {}
  for (const n of nodes) {
    const sid = classifyNode(n)
    if (sid == null) {
      assignments.push({ id: n.id, subsystem_id: null, rule_name: null, unmatched_material: n.material_name, unmatched_op: n.operation_name })
    } else {
      const rule = RULES.find(r => r.id === sid)
      assignments.push({ id: n.id, subsystem_id: sid, rule_name: rule?.name })
      summary[sid] = (summary[sid] || 0) + 1
    }
  }
  return { assignments, summary }
}

module.exports = { classifyNode, classifyBatch, RULES }
