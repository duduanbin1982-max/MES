import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElIcons from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import { ElMessage } from 'element-plus'
import './style.css'

const app = createApp(App)

// 注册全部 Element 图标
for (const [name, comp] of Object.entries(ElIcons)) {
  app.component(name, comp as any)
}

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
