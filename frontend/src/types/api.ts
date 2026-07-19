export type ApiRecord = Record<string, any>

export interface KitCheckItem {
  material_id: number
  material_code?: string
  material_name?: string
  unit?: string
  required_qty: number
  available_qty: number
  shortage_qty: number
  fulfill_rate?: number
  status?: string
}

export interface KitCheckResult {
  kit_ready: boolean
  kit_rate: number
  total_items: number
  short_items: number
  items: KitCheckItem[]
  summary?: string
}
