// frontend/src/domain/ux.ts
// 2026-11-07 全局 UI/UX 审计：可单测的壳层体验纯函数

export const APP_NAME = 'TBM-MES'
export const APP_DESCRIPTION = '成套装备生产管理'

export function buildPageTitle(title?: string): string {
  const text = String(title || '').trim()
  return text ? `${text} · ${APP_NAME}` : `${APP_NAME} · ${APP_DESCRIPTION}`
}

export interface ToastMark {
  message: string
  at: number
}

/**
 * 是否应该弹出错误提示：
 * - 用户主动取消/中断的请求不提示
 * - 401 已由登录过期逻辑处理，不重复提示
 * - 相同文案 3 秒内只提示一次（并发请求/轮询避免刷屏）
 */
export function shouldToastError(
  status: number | undefined,
  isCancelled: boolean,
  message: string,
  now: number,
  last: ToastMark | null,
  windowMs = 3000,
): boolean {
  if (isCancelled) return false
  if (status === 401) return false
  if (last && last.message === message && now - last.at < windowMs) return false
  return true
}

/** 离线横幅：网络离线时展示；用户关闭后本次离线期间不再打扰 */
export function shouldShowOfflineBanner(online: boolean, dismissed: boolean): boolean {
  return !online && !dismissed
}

/** 路由进度条持续时间保护（避免卡死在错误状态） */
export function shouldForceFinishProgress(startedAt: number, now: number, timeoutMs = 10000): boolean {
  return now - startedAt >= timeoutMs
}
