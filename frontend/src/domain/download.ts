// frontend/src/domain/download.ts
// 2026-10-19：文档下载相关纯逻辑（可被 test:domain 覆盖）。

/**
 * 从 Content-Disposition 解析文件名。
 * 兼容两种写法：
 *   attachment; filename="%E5%89%8D%E7%9B%BE.png"   （后端用 encodeURIComponent）
 *   attachment; filename*=UTF-8''%E5%89%8D%E7%9B%BE.png （RFC 5987）
 * 解析失败/非法百分号编码时回退到 fallback，绝不抛错。
 */
export function parseContentDispositionFilename(header?: string | null, fallback = 'download'): string {
  if (!header) return fallback
  const text = String(header)

  const extended = /filename\*\s*=\s*([^;]+)/i.exec(text)
  if (extended) {
    let value = extended[1].trim().replace(/^["']|["']$/g, '')
    const parts = value.split("''")
    if (parts.length === 2) value = parts[1]
    const decoded = safeDecode(value)
    if (decoded) return decoded
  }

  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(text)
  if (plain) {
    const raw = (plain[2] !== undefined ? plain[2] : plain[1]).trim()
    const decoded = safeDecode(raw)
    if (decoded) return decoded
  }

  return fallback
}

function safeDecode(value: string): string {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    return decodeURIComponent(text)
  } catch (_error) {
    return text
  }
}
