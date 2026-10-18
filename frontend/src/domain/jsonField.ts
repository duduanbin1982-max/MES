// frontend/src/domain/jsonField.ts
// 修复（2026-10-18）：配置类字段在「对象 ↔ 输入框文本」之间转换。
// 背景：GET 接口返回的是**对象**（scope_config / data_scope_config），
// 直接 v-model 到 el-input 会显示 "[object Object]"；再保存时若字段没被改写，
// 就会出现"提示已保存但看起来没变"的假象。这里统一做格式化。

/** 把对象/JSON 字符串/空值 → 输入框里的可读文本（空值返回 ''） */
export function formatJsonForInput(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return ''
    try {
      const parsed = JSON.parse(text)
      return JSON.stringify(parsed, null, 2)
    } catch (_error) {
      return text // 非法 JSON 原样展示，交给用户修
    }
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    } catch (_error) {
      return ''
    }
  }
  return String(value)
}

/** 输入框文本 → 对象（空文本返回 undefined，表示"不修改该字段"） */
export function parseJsonInput(text: unknown, label = '配置'): unknown {
  if (text === null || text === undefined) return undefined
  const raw = String(text).trim()
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch (error) {
    const err: any = new Error(label + ' 不是合法 JSON')
    err.cause = error
    throw err
  }
}
