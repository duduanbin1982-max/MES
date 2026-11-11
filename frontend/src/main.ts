import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/theme-chalk/base.css'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import 'element-plus/es/components/loading/style/css'
import { ElLoading, ElMessage, ElMessageBox } from 'element-plus'
import { appIcons } from './icons'
import PageState from './components/PageState.vue'
import PageToolbar from './components/PageToolbar.vue'
import App from './App.vue'
import router from './router'
import './style.css'
import { startScanSync } from './mobile/useScanSync'

const app = createApp(App)

// 2026-11-07 UI/UX P3：只注册实际使用的图标（73/293），显著减小 vendor 体积
for (const [name, comp] of Object.entries(appIcons)) {
  app.component(name, comp as any)
}
// 页面状态/工具栏组件全局注册，供各页面统一使用
app.component('PageState', PageState)
app.component('PageToolbar', PageToolbar)

app.use(createPinia())
app.use(router)
// 按需组件模式下仍需的全局指令（v-loading）
app.directive('loading', ElLoading.directive)

// 编程式 MessageBox 默认中文按钮（脱离全量 app.use 后避免回退英文）
const rawConfirm = ElMessageBox.confirm
;(ElMessageBox as any).confirm = (message: any, title?: any, options: any = {}) => rawConfirm(message, title, {
  confirmButtonText: '确定',
  cancelButtonText: '取消',
  ...options,
})
app.config.errorHandler = (error, _instance, info) => {
  // 兜底：组件渲染/事件异常不再静默白屏，也不把堆栈直接暴露给用户
  // eslint-disable-next-line no-console
  console.error('[app-error]', info, error)
  ElMessage.error('页面发生异常，请刷新页面或联系管理员')
}
window.addEventListener('unhandledrejection', (event) => {
  // eslint-disable-next-line no-console
  console.error('[unhandled-rejection]', event.reason)
})
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  ;(window as any).__tbmInstallPrompt = event
  window.dispatchEvent(new Event('tbm-install-available'))
})

app.mount('#app')
startScanSync()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[pwa] service worker 注册失败', error)
    })
  })
}
