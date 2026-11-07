import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { appIcons } from './icons'
import PageState from './components/PageState.vue'
import PageToolbar from './components/PageToolbar.vue'
import App from './App.vue'
import router from './router'
import { ElMessage } from 'element-plus'
import './style.css'

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
app.use(ElementPlus, { locale: zhCn })
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
app.mount('#app')
