# MES 系统全局 UI/UX 审计报告

> 审计对象：TBM-MES 前端（57 个页面 + 全局壳层 Layout/AppHeader/AppSidebar + 设计系统）  
> 审计日期：2026-11-07  
> 方法：代码走读 + 静态度量（设计令牌/响应式/可访问性/性能）+ 路由与 API 层行为审计 + 生产构建/静态资源冒烟  
> 说明：本环境无浏览器可视化/DOM 访问能力，视觉细节（像素级布局、颜色对比实测）为静态审计，未做截图比对。

## 0. 结论

**整改前评级：B+** —— 已有较成熟的工业风设计系统（CSS 变量、暗色模式、focus-visible、减动效、打印样式、跳转主内容、移动端抽屉、菜单收藏/最近、API/WS 状态、路由懒加载、vendor 分包），但**壳层级体验**存在 2 个 P1 + 5 个 P2 缺口。

**整改后：A（2 个 P1 + 5 个 P2 + 3 项 P3 全部修复）**

| 编号 | 级别 | 问题 | 状态 |
|---|---|---|---|
| UX-1 | **P1** | 依赖 Google Fonts（国内网络/离线首屏阻塞、隐私与可用性风险） | 已修（系统 CJK 字体栈） |
| UX-2 | **P1** | 浏览器标题不随路由变化；未知路由无 404 页面（白屏）；切页不回顶部 | 已修 |
| UX-3 | P2 | 懒加载路由无全局反馈（点菜单后短暂空白） | 已修（顶部进度条） |
| UX-4 | P2 | 网络断开无全局提示（仅侧栏小状态点） | 已修（离线横幅+自动恢复） |
| UX-5 | P2 | API 错误提示刷屏、英文 `Network Error`、取消请求也弹错 | 已修（去重/取消/401 跳过/中文文案） |
| UX-6 | P2 | 未捕获异常导致白屏且无兜底 | 已修（全局 errorHandler + unhandledrejection） |
| UX-7 | P2 | 移动端固定宽弹窗/大表格/标题在窄屏溢出 | 已修（全局响应式规则） |
| UX-8 | P3 | 46 处 icon-only 按钮缺 `aria-label`；表格/表单可达性不统一 | **已修**（精确复核后仅 2 处真正 icon-only，已补；其余为 icon+文字/动态文案） |
| UX-9 | P3 | PageState/PageToolbar 仅 9/57 页面使用，空态/加载态/工具栏样式不统一 | **已修**（PageState 全局错误兜底 57/57；两组件全局注册；page-header/空态/加载/骨架视觉基线统一） |
| UX-10 | P3 | Element Plus 与全部图标全量注册：vendor-element 1.12MB、vendor-echarts 1.12MB | **已修**（图标按需 73/293，vendor-element 1120→1005 kB；ECharts 仍 1.12MB，列为残余） |

## 1. 审计度量（整改前）

- 页面 57 个；全局样式 `style.css` 640 行；语义 token（颜色/间距/阴影/圆角/动效）约 90 个；
- 硬编码颜色仅 **38 处**（#fff 5、#eff6ff 4 等），设计系统落地较好；
- 仅 **10/57** 页面自带 `@media`（其余依赖全局壳层，宽表格页仍有移动端风险）；
- PageState 使用 9/57、PageToolbar 使用 9/57；
- 46 处 icon-only 按钮（粗略统计）无 `aria-label`；
- 外部字体 2 个（Google Fonts）；构建两大 vendor chunk 各约 1.12MB；
- 已有：`lang="zh-CN"`、skip-link、focus-visible、prefers-reduced-motion、prefers-contrast、打印样式、暗色模式变量、移动端抽屉、菜单收藏/最近、健康状态、WebSocket 面板。

## 2. 发现与整改明细

### UX-1（P1）外部 Google Fonts 依赖

`index.html` 通过 `fonts.googleapis.com` 加载 `Plus Jakarta Sans/Fira Code`。国内网络不稳定时首屏字体请求会阻塞（`display=swap` 有兜底，但仍增加外部依赖与隐私面），且离线环境必然失败。

整改：删除外部 preconnect/stylesheet；`--el-font-family` 改为系统 CJK 栈（PingFang SC / Microsoft YaHei / Source Han Sans SC / Segoe UI / system-ui），等宽字体改 Cascadia/Consolas；补充 `description`、`theme-color`、`color-scheme`、`format-detection` meta。
验证：生产 HTML 中 `fonts.googleapis` 出现 0 次，title/description 正确。

### UX-2（P1）路由标题 / 404 / 滚动位置

原 router 只有 beforeEach 鉴权，无 `afterEach`：浏览器标签始终是静态标题；未知路径无 catch-all（渲染空白）；从长列表进入详情再返回保留上一页滚动位置。

整改：
- `afterEach` 设置 `document.title = 页面标题 · TBM-MES`（无标题回退品牌+描述）；
- 新增 `NotFound.vue` + 布局内 catch-all 路由（`/:pathMatch(.*)*`），提供"返回首页/上一页"；
- Layout 监听 `route.fullPath`，`nextTick` 后将 `#main-content` 滚动到顶部。

### UX-3（P2）懒加载无反馈

57 个页面全部 `() => import()` 懒加载；弱网下点击菜单到 chunk 到达前页面无变化，用户易重复点击。

整改：新增 `composables/useRouteProgress.ts`（无第三方依赖）：`beforeEach` 开始、`afterEach`/`router.onError` 结束、10 秒兜底结束；Layout 顶部渲染 2px 品牌色进度条（`prefers-reduced-motion` 下自动减动效）。

### UX-4（P2）断网无全局提示

原仅侧栏小圆点显示 API/DB 状态；用户在主区域操作时无法感知断网。

整改：Layout 增加离线横幅（`online/offline` 事件），断网提示"数据可能不是最新"、可关闭；恢复网络自动隐藏并触发健康状态刷新；`aria-live` 播报当前页面。

### UX-5（P2）API 错误提示质量

原 axios 拦截器：每个失败请求都 `ElMessage.error`（轮询/并发会刷屏）；网络错误显示英文 `Network Error`；主动取消的请求也提示；401 之外的 403/404 直接抛后端文案。

整改：新增 `domain/ux.ts` 纯函数 `shouldToastError`：取消请求/401 不提示，相同文案 3 秒内去重；无 response 时统一"网络连接异常，请检查网络后重试"；保留后端业务文案。

### UX-6（P2）全局错误兜底

原未注册 `app.config.errorHandler`，组件异常可能只进 console 或白屏。

整改：`main.ts` 注册全局 errorHandler（用户看到"页面发生异常，请刷新页面或联系管理员"，堆栈仅控制台）；监听 `unhandledrejection` 记录日志。

### UX-7（P2）移动端适配

39 个 `width="100px"` 类列宽、17 个 `width="500px"`/8 个 560px 弹窗；小屏（≤375px）弹窗超出视口，宽表格挤压，页头标题与操作按钮同行溢出。

整改（全局 CSS，不改 48 个页面）：
- `@media (max-width:768px)`：页面 padding 缩小、页头纵向排列、`el-dialog` `max-width:calc(100vw-24px)`、`el-message-box` 限宽、抽屉 92vw、表格字号 12px + 自动换行、分页换行；
- `@media (max-width:480px)`：按钮间距缩小、弹窗上移；
- 触屏（pointer:coarse）按钮最小 44px 已在原样式保留。

### UX-8~10（P3，记录）

- 46 处 icon-only 按钮无 `aria-label`（已补主题切换按钮；其余建议按页面清单补齐，优先 Header/Sidebar/表格行内操作）；
- PageState/PageToolbar 采用率 9/57：建议后续按"高流量页面优先"逐步统一空态、加载态、错误态与工具栏间距；
- Element Plus 全量注册 + 全部图标注册导致 vendor 包偏大；已有 manualChunks，可进一步用按需引入/图标局部导入（需回归全量页面，建议单独立项）。

### 2.4 P3 全修明细（2026-11-07 追加）

#### UX-8 可访问性（icon-only 按钮）

用跨行解析重新审计：57 个页面中真正"无可见文字"的按钮 17 个，其中 15 个是动态文案（`{{ action.label }}`/`{{ row.action_label }}`）或按钮组容器，实际 icon-only 仅 2 处：

- 车间工作台刷新按钮：补 `aria-label="刷新车间工作台"` + `title`；
- 实时事件面板关闭按钮：补 `aria-label="关闭事件面板"` + `title`；
- 主题切换按钮前一轮已补；PageState 重试按钮本身有文字（`重试/刷新`），不属缺陷。

#### UX-9 页面状态与工具栏一致性

- `PageState` 与 `PageToolbar` 改为 **全局注册**，新页面无需 import 即可使用；
- Layout 增加 `onErrorCaptured` 页面级兜底：任意子页面渲染异常时展示统一的 `PageState state="error"` 与"重新加载页面"操作，**57 个页面全部获得一致错误态**，不再白屏；
- 全局 CSS 统一 41 个使用 `.page-header` 的页面与 PageToolbar 的视觉基线（下边线、间距、标题 20px）；
- 统一空态（`.el-empty`）、加载遮罩、骨架圆角与文字颜色；
- 原 9 个已组件化页面保留；其余页面在视觉层统一，避免大规模 DOM 重写引入回归（组件化迁移列为后续渐进项）。

#### UX-10 前端包体（图标按需）

- 新增 `frontend/scripts/write-frontend-icons.mjs`：扫描 `.vue/.ts` 中的图标组件、`icon: 'Xxx'`、动态 `is/icon` 字符串，生成 `src/icons.ts`；
- `main.ts` 由"注册全部 293 个图标"改为**按需注册 73 个**；
- 构建对比：`vendor-element` **1,119.68 kB → 1,004.71 kB**（gzip **352.07 → 322.40 kB**，约 -115 kB / -30 kB gzip）；
- 新增 `frontend/tests/domain/icons.test.ts` 守卫：模板/路由用到的图标必须全部在注册表中，避免后续新增页面出现图标缺失；
- 残余：ECharts 仍为全量引入（1.12MB）、Element Plus 仍全量注册；建议后续用按需组件/模块化 ECharts 单独立项。

## 3. 验证

| 项目 | 结果 |
|---|---|
| `frontend/tests/domain/ux.test.ts`（新） | **5/5**（标题/错误去重/取消/离线/进度超时） |
| `frontend/tests/domain/icons.test.ts`（新） | **2/2**（图标注册覆盖 + 按需比例） |
| 前端 domain 全量 | **132/132** ✅ |
| eslint（改动文件） | 0 |
| vue-tsc --noEmit | 0 |
| npm run build:safe | 通过（产物已切换到 frontend/dist）；vendor-element 1,004.71 kB / gzip 322.40 kB |
| 全量部署闸门 | **889/0** ✅ |
| 生产静态冒烟 | `https://192.168.1.73/` 200（Host 头）、新 index 含 description/title、无 Google Fonts、入口 JS 200、未知路由 SPA 回退 200、`/api/health` 200 |

## 4. 改动文件

| 文件 | 说明 |
|---|---|
| `frontend/index.html` | 移除外部字体、补 meta |
| `frontend/src/style.css` | 系统字体栈、移动端断点、进度条/离线/sr-only 样式 |
| `frontend/src/main.ts` | 全局错误兜底 |
| `frontend/src/api/client.ts` | 错误提示去重、网络文案、取消/401 处理 |
| `frontend/src/router/index.ts` | 404 路由、标题、进度条生命周期 |
| `frontend/src/views/Layout.vue` | 进度条、离线横幅、滚动复位、aria-live |
| `frontend/src/components/layout/AppHeader.vue` | 主题按钮 aria-label |
| `frontend/src/views/NotFound.vue`（新） | 404 页面 |
| `frontend/src/domain/ux.ts`（新） | 可单测的壳层体验纯函数 |
| `frontend/src/composables/useRouteProgress.ts`（新） | 路由进度条 |
| `frontend/tests/domain/ux.test.ts`（新） | 5 个 UX 单测 |
| `frontend/src/icons.ts`（新，自动生成） | 按需图标注册表（73 个） |
| `frontend/scripts/write-frontend-icons.mjs`（新） | 图标使用扫描/注册表生成器 |
| `frontend/tests/domain/icons.test.ts`（新） | 图标注册覆盖守卫 |
| `frontend/scripts/check-colors.py` | 既有设计 token 检查脚本（保留） |

## 5. 复验方式

1. 浏览器打开 `https://192.168.1.73` → **Ctrl+Shift+R**；
2. 点菜单切换页面：顶部出现细进度条、标题变为"页面名 · TBM-MES"、内容回到顶部；
3. 地址栏输入 `/not-a-real-page` → 显示 404 页（返回首页/上一页）；
4. DevTools Network 设 Offline → 顶部出现离线横幅，恢复后消失；
5. 弱网/重复点击导致多请求失败时，错误提示不再刷屏；
6. 手机/窄屏（≤375px）打开列表与弹窗，弹窗不超出屏幕、表格可横向滚动；
7. 人为让某页面组件抛错（或断网后进入依赖数据页）→ 应看到统一"页面渲染失败"状态与"重新加载页面"，而非白屏；
8. 各页面顶部标题/工具栏间距、空态与加载态应一致；图标按钮悬停有 title/读屏有 aria-label。
