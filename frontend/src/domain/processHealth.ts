// frontend/src/domain/processHealth.ts
// 2026-10-19：全流程健康检查的展示逻辑（纯函数，可单测）。

export type HealthStatus = 'ok' | 'partial' | 'empty'
export type HealthGrade = 'healthy' | 'partial' | 'blocked'

export interface HealthStage {
  key: string
  label: string
  page: string
  status: HealthStatus
  score: number
  action?: string
  blockers?: string[]
  metrics?: Array<{ key: string; label: string; value: number; required?: number | null }>
}

export function statusLabel(status: HealthStatus): string {
  if (status === 'ok') return '已通'
  if (status === 'partial') return '部分'
  return '未开始'
}

export function statusTone(status: HealthStatus): 'success' | 'warning' | 'info' {
  if (status === 'ok') return 'success'
  if (status === 'partial') return 'warning'
  return 'info'
}

export function gradeLabel(grade?: HealthGrade | string): string {
  if (grade === 'healthy') return '流程健康'
  if (grade === 'partial') return '部分可跑'
  return '流程阻塞'
}

export function gradeTone(grade?: HealthGrade | string): 'success' | 'warning' | 'danger' {
  if (grade === 'healthy') return 'success'
  if (grade === 'partial') return 'warning'
  return 'danger'
}

export function metricText(metrics?: HealthStage['metrics']): string {
  const list = metrics || []
  if (!list.length) return '—'
  return list.map((item) => `${item.label} ${item.value}`).join(' · ')
}

export function blockerText(stage: HealthStage, max = 2): string {
  const list = (stage.blockers || []).slice(0, max)
  return list.join('；')
}

const VALID_STATUS: HealthStatus[] = ['ok', 'partial', 'empty']

/** 卡片行：把接口返回的 stages 整理成可直接渲染的行（非法状态回落 empty） */
export function stageRows(stages?: HealthStage[]): HealthStage[] {
  return (stages || []).map((stage) => ({
    ...stage,
    status: VALID_STATUS.includes(stage.status as HealthStatus) ? (stage.status as HealthStatus) : 'empty',
    score: Number(stage.score) || 0,
    metrics: stage.metrics || [],
    blockers: stage.blockers || [],
  }))
}

/** 下一步动作文案（最多 3 条） */
export function nextActionLines(actions?: Array<{ stage: string; action: string }>): string[] {
  return (actions || []).slice(0, 3).map((item) => `${item.stage}：${item.action}`)
}
