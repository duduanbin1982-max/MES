export function workflowLabel(key: string) {
  const labels: Record<string, string> = { contract: '合同', bom: 'BOM', documents: '图纸', process: '工艺', purchase: '采购', kit: '齐套', work_orders: '工单', report: '报工', quality: '质检', cost: '成本', acceptance: '验收' }
  return labels[key] || key
}

export function stageByKey(project: any, key: string) {
  return (project.stages || []).find((stage: any) => stage.key === key) || { key, label: workflowLabel(key), done: 0, total: 0, percent: 0, status: 'empty', owner_role: '-', action_label: '查看', path: '', blockers: [], blocker_count: 0 }
}

export function statusTag(status: string) {
  return status === 'blocked' ? 'danger' : status === 'warning' ? 'warning' : status === 'done' ? 'success' : status === 'running' ? 'primary' : 'info'
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = { blocked: '阻塞', warning: '预警', done: '完成', running: '进行中', pending: '待开始', empty: '未建' }
  return labels[status] || status || '-'
}

export function lineageStatusTag(status: string) {
  return status === 'blocked' ? 'danger' : status === 'warning' ? 'warning' : status === 'ok' ? 'success' : 'info'
}

export function lineageStatusLabel(status: string) {
  const labels: Record<string, string> = { blocked: '阻塞', warning: '待完善', ok: '完整', empty: '未建' }
  return labels[status] || status || '-'
}

export function riskTag(level: string) {
  return level === 'critical' || level === 'high' ? 'danger' : level === 'warning' ? 'warning' : 'success'
}

export function riskLabel(level: string) {
  const labels: Record<string, string> = { critical: '严重', high: '高风险', warning: '预警', normal: '正常' }
  return labels[level] || level || '-'
}

export function severityTag(severity: string) {
  return severity === 'critical' || severity === 'high' ? 'danger' : severity === 'warning' ? 'warning' : 'info'
}

export function severityLabel(severity: string) {
  const labels: Record<string, string> = { critical: '严重', high: '高', warning: '中', info: '低' }
  return labels[severity] || severity
}

export function fixEntry(row: any) {
  return row?.fix_entry || {
    module: row?.owner_role || '业务模块',
    label: row?.action_label || '进入处理',
    path: row?.action_path || row?.path,
    checklist: [],
  }
}

export function money(value: any) {
  return Number(value || 0).toLocaleString('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 })
}
