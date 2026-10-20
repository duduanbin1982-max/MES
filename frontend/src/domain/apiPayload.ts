// frontend/src/domain/apiPayload.ts
// 2026-10-21：后端有些接口直接返回数组、有些返回 { items }。
// 前端如果只按一种形态取，就会出现"有数据但列表为空"（BOM 新增行的物料下拉就是这么坏的）。

/** 把可能是 数组 / {items} / {data} / {rows} 的响应统一成数组 */
export function asArray<T = any>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (!payload || typeof payload !== 'object') return []
  for (const key of ['items', 'data', 'rows', 'list']) {
    if (Array.isArray(payload[key])) return payload[key] as T[]
  }
  return []
}
