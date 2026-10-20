// frontend/src/domain/instanceEdit.ts
// 2026-10-21：「编辑项目信息」表单 → PUT /api/equipment_instances/:id 的请求体构造（纯函数，可单测）。

/** 进度百分比：四舍五入、夹在 0~100、非法值回 0 */
export function normalizeProgressPct(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** 只提交后端允许的字段，空字符串转 null（避免把已填字段清成空串） */
export function buildInstancePatch(form: Record<string, any>): Record<string, any> {
  const pick: Array<[string, (v: any) => any]> = [
    ['instance_name', (v) => text(v)],
    ['project_no', (v) => text(v)],
    ['serial_no', (v) => text(v)],
    ['customer_name', (v) => text(v)],
    ['customer_contact', (v) => text(v)],
    ['site_location', (v) => text(v)],
    ['contract_no', (v) => text(v)],
    ['contract_amount', (v) => numberOrNull(v)],
    ['planned_start', (v) => text(v)],
    ['planned_end', (v) => text(v)],
    ['notes', (v) => text(v)],
    ['progress_pct', (v) => normalizeProgressPct(v)],
  ]
  const patch: Record<string, any> = {}
  for (const [key, cast] of pick) {
    if (form[key] === undefined) continue
    patch[key] = cast(form[key])
  }
  return patch
}

function text(value: any): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}

function numberOrNull(value: any): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
