import test from 'node:test'
import assert from 'node:assert/strict'

import {
  APP_DESCRIPTION,
  APP_NAME,
  buildPageTitle,
  shouldForceFinishProgress,
  shouldShowOfflineBanner,
  shouldToastError,
} from '../../src/domain/ux.ts'

test('UX.1 页面标题：有标题拼品牌，无标题用默认描述', () => {
  assert.equal(buildPageTitle('仪表盘'), `仪表盘 · ${APP_NAME}`)
  assert.equal(buildPageTitle('  质量追溯  '), `质量追溯 · ${APP_NAME}`)
  assert.equal(buildPageTitle(''), `${APP_NAME} · ${APP_DESCRIPTION}`)
  assert.equal(buildPageTitle(undefined), `${APP_NAME} · ${APP_DESCRIPTION}`)
})

test('UX.2 错误提示：取消/401 不提示，其余提示', () => {
  assert.equal(shouldToastError(400, true, '参数错误', 1000, null), false)
  assert.equal(shouldToastError(401, false, '未登录', 1000, null), false)
  assert.equal(shouldToastError(500, false, '服务异常', 1000, null), true)
  assert.equal(shouldToastError(undefined, false, '网络异常', 1000, null), true)
})

test('UX.3 错误提示去重：3 秒内相同文案只提示一次', () => {
  const last = { message: '网络异常', at: 1000 }
  assert.equal(shouldToastError(undefined, false, '网络异常', 2000, last), false)
  assert.equal(shouldToastError(undefined, false, '网络异常', 4500, last), true)
  assert.equal(shouldToastError(undefined, false, '服务异常', 2000, last), true)
})

test('UX.4 离线横幅：离线且未关闭时展示', () => {
  assert.equal(shouldShowOfflineBanner(false, false), true)
  assert.equal(shouldShowOfflineBanner(false, true), false)
  assert.equal(shouldShowOfflineBanner(true, false), false)
})

test('UX.5 路由进度条超时保护', () => {
  assert.equal(shouldForceFinishProgress(1000, 5000), false)
  assert.equal(shouldForceFinishProgress(1000, 12000), true)
  assert.equal(shouldForceFinishProgress(1000, 12000, 20000), false)
})
