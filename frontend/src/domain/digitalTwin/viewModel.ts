// frontend/src/domain/digitalTwin/viewModel.ts
//
// DigitalTwin 视图的纯逻辑：响应归一化、整机查找、指标配色、部件查询键。
// 2026-10-11 从 frontend/src/views/DigitalTwin.vue 抽出。
// 按 frontend/src/domain 层约束，这里不 import vue / element-plus / api。

export interface MetricLike {
  metric_name?: string
  metric_value?: number
}

/** 后端有的接口返回 { items: [...] }，有的直接返回数组 */
export function pickFirstModel(response: unknown): any {
  const rows: any = (response as any)?.items ?? response ?? []
  return Array.isArray(rows) ? rows[0] : rows
}

/** 按 id 找整机；找不到返回 null */
export function resolveInstanceById(instances: any[] | undefined | null, id: number): any {
  return (instances || []).find((item) => item.id === id) ?? null
}

/** 温度/振动指标按阈值配色，其余用主题主色 */
export function metricColor(metric: MetricLike | null | undefined): string {
  if (!metric) return "var(--el-color-white)"
  const value = Number(metric.metric_value ?? 0)
  const name = metric.metric_name || ""
  if (name.includes("temp")) {
    return value > 80 ? "var(--el-color-danger)" : value > 60 ? "var(--el-color-warning)" : "var(--el-color-success)"
  }
  if (name.includes("vibration")) {
    return value > 7 ? "var(--el-color-danger)" : "var(--el-color-success)"
  }
  return "var(--el-color-primary)"
}

/** 点击图例时用哪个键去 partMeshes 里找 mesh */
export function partLookupKey(part: { mesh_name?: string; part_name?: string } | null | undefined): string | null {
  if (!part) return null
  return part.mesh_name || part.part_name || null
}
