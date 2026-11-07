# MES 系统全局 UI/UX 审计报告

> 审计对象：TBM-MES 前端（57 个页面 + 全局壳层 Layout/AppHeader/AppSidebar + 设计系统）  
> 审计日期：2026-11-07  
> 方法：代码走读 + 静态度量（设计令牌/响应式/可访问性/性能）+ 路由与 API 层行为审计 + 生产构建/静态资源冒烟  
> 说明：本环境无浏览器可视化/DOM 访问能力，视觉细节（像素级布局、颜色对比实测、组件运行时渲染）为静态审计 + 构建/产物验证，未做截图比对；PageToolbar 包裹迁移后建议重点浏览器复验页头布局。

## 0. 结论

**整改前评级：B+** —— 已有较成熟的工业风设计系统（CSS 变量、暗色模式、focus-visible、减动效、打印样式、跳转主内容、移动端抽屉、菜单收藏/最近、API/WS 状态、路由懒加载、vendor 分包），但**壳层级体验**存在 2 个 P1 + 5 个 P2 缺口。

**整改后：A（2 个 P1 + 5 个 P2 + 3 项 P3 + 3 项后续优化全部完成）**

| 编号 | 级别 | 问题 | 状态 |
|---|---|---|---|
| UX-1 | **P1** | 依赖 Google Fonts（国内网络/离线首屏阻塞、隐私与可用性风险） | 已修（系统 CJK 字体栈） |
| UX-2 | **P1** | 浏览器标题不随路由变化；未知路由无 404 页面（白屏）；切页不回顶部 | 已修 |
| UX-3 | P2 | 懒加载路由无全局反馈（点菜单后短暂空白） | 已修（顶部进度条） |
| UX-4 | P2 | 网络断开无全局提示（仅侧栏小状态点） | 已修（离线横幅+自动恢复） |
| UX-5 | P2 | API 错误提示刷屏、英文 `Network Error`、取消请求也弹错 | 已修（去重/取消/401 跳过/中文文案） |
| UX-6 | P2 | 未捕获异常导致白屏且无兜底 | 已修（全局 errorHandler + unhandledrejection） |
| UX-7 | P2 | 移动端固定宽弹窗/大表格/标题在窄屏溢出 | 已修（全局响应式规则） |
| UX-8 | P3 | icon-only 按钮缺 `aria-label`；表格/表单可达性不统一 | **已修**（精确复核后真正 icon-only 仅 2 处，已补 aria-label+title） |
| UX-9 | P3 | PageState/PageToolbar 仅 9/57 页面使用，空态/加载态/工具栏样式不统一 | **已修**（PageState 45 个文件、PageToolbar 47 个文件；剩余 el-empty 0；PageState 全局错误兜底） |
| UX-10 | P3 | Element Plus 与全部图标全量注册：vendor-element 1.12MB、vendor-echarts 1.12MB | **已修**（Element Plus 组件按需 + 图标 73/293 + ECharts 模块化：vendor-element 1120→954 kB、ECharts 1120→656 kB） |

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

### 2.5 后续优化项全修（本轮追加）

#### A. ECharts 模块化（1.12MB → 656KB）

- 新增 `src/utils/echarts.ts`：`echarts/core` + 按需注册 `BarChart/LineChart/PieChart/ScatterChart/TreeChart`、`Grid/Tooltip/Legend/Title/DataZoom/MarkLine/Graphic`、`CanvasRenderer`；
- 7 个使用点（Spc/ProcessParams/Andon/DashboardProjectRisk/useMindmapChart/useMaterialAlertsPage/useOeePage）由 `import * as echarts from 'echarts'` 改为 `import { echarts } from 'utils/echarts'`；
- 构建对比：`vendor-echarts` **1,117.85 kB → 655.55 kB**（gzip **370.86 → 222.85 kB**，约 -462 kB / -148 kB gzip）。

#### B. Element Plus 按需引入（vendor-element 1.12MB → 954KB，CSS 357→282KB）

- 新增开发依赖 `unplugin-vue-components`，在 `vite.config.js` 注册 `ElementPlusResolver`（组件 + 按需 CSS 自动引入）；
- `main.ts` 移除 `import ElementPlus` 与 `app.use(ElementPlus)`、移除全量 `element-plus/dist/index.css`；保留并按需注册 `v-loading` 指令、`ElMessage/ElMessageBox` 样式；
- `App.vue` 使用 `<el-config-provider :locale="zhCn">` 提供中文 locale；`ElMessageBox.confirm` 统一默认中文按钮，避免脱离全量安装后出现英文按钮；
- 构建对比：`vendor-element` **1,119.68 kB → 954.04 kB**（gzip 352.07→308.71 kB），组件 CSS **356.37 → 281.72 kB**（gzip 47.61→37.41 kB）；
- 工程说明：Vite 8（Rolldown）在"按需组件 + 动态路由分包"组合下触发 Rolldown panic（`easeInOutCubic should belong to a chunk`），无法产出稳定构建；已将 `vite` 固定到 **7.3.7（Rollup）**，构建恢复稳定。该 downgrade 为构建稳定性取舍，功能/产物验证通过。

#### C. PageState/PageToolbar 组件化（9/57 → 45/57、47/57，剩余 el-empty 0）

- 全局注册 `PageState`/`PageToolbar`；
- 自动迁移 57 处自闭合 `<el-empty>` 为 `<PageState state="empty" compact :show-action="false">`，并补齐 6 处带操作按钮的空态（`#actions` 插槽）；**剩余 el-empty 0**；
- 38 个 `.page-header` 块包裹为 `<PageToolbar class="page-header">`（PageToolbar 新增默认插槽兼容既有内容、保留原左右布局），PageToolbar 覆盖 **47 个页面**，PageState 覆盖 **45 个文件**；
- 全局 CSS 处理 `el-card` 内 PageState 的双层边框；空态/加载/骨架统一；页面错误态由 Layout 的 PageState 统一兜底。

### 2.6 事故修复：工艺树页面“页面渲染失败”（2026-11-07）

**现象**：打开 `/process-tree` 显示 Layout 的统一错误态“页面加载或渲染时发生异常”。

**定位**：用安装后的 Playwright + headless Chromium 注入 admin 登录态访问生产页面，捕获到：

```
ReferenceError: defineModel is not defined
  at setup (ProcessTree-*.js)
```

**根因**：`frontend/src/components/ProcessTreeDialogs.vue` 使用 **无 `lang="ts"` 的 `<script setup>`**，却写了 TS 泛型宏 `defineModel<any>('editForm', ...)`。在 Vite 8（Rolldown）构建链下被容忍；本轮切换到 Vite 7（Rollup，用于规避按需组件触发的 Rolldown panic）后，SFC 编译器未把该调用识别/改写为运行时宏，产物中残留 `defineModel(...)`，浏览器执行 setup 即抛 `ReferenceError`，被 Layout 的 `onErrorCaptured` 捕获并展示为“页面渲染失败”。

**修复**：将该文件中 4 处 `defineModel<any>(...)` 改为 `defineModel(...)`（无类型泛型，符合纯 JS script setup）；构建通过。

**验证**：
- Playwright 单页：`/process-tree` 标题“工艺树 · TBM-MES”、正文正常（工艺树标题、实例选择、统计卡、完整性卡等），**pageerror 0、console error 0**；
- Playwright 全站冒烟 23 个路由：23/23 无渲染失败（`/audit-logs`、`/equipment-instances` 为地址不存在的 404 页，非异常）；
- 全量部署闸门 889/0；build:safe 部署。

**经验**：纯 JS 的 `<script setup>` 中不要使用 TS 泛型宏；如需泛型请标注 `lang="ts"`，并保留 Playwright/浏览器冒烟作为构建通过之外的运行时守门。

## 3. 验证

| 项目 | 结果 |
|---|---|
| `frontend/tests/domain/ux.test.ts`（新） | **5/5**（标题/错误去重/取消/离线/进度超时） |
| `frontend/tests/domain/icons.test.ts`（新） | **2/2**（图标注册覆盖 + 按需比例） |
| 前端 domain 全量 | **132/132** ✅ |
| eslint（改动文件） | 0 |
| vue-tsc --noEmit | 0 |
| npm run build:safe | 通过（产物已切换到 frontend/dist）；vendor-element 954.04 kB / gzip 308.71 kB；ECharts 655.55 kB / gzip 222.85 kB；CSS 281.72 kB / gzip 37.41 kB |
| 全量部署闸门 | **889/0** ✅ |
| 生产静态冒烟 | `https://192.168.1.73/` 200、入口 JS 200、CSS 200、SPA `/spc` 200、未知路由回退 200、`/api/health` 200 |
| Playwright 运行时冒烟 | 23 个路由全通过（含 `/process-tree`），无 pageerror/console error |

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
| `frontend/src/utils/echarts.ts`（新） | ECharts 模块化按需注册 |
| `frontend/vite.config.js` | unplugin-vue-components 按需组件 + vendor 分包 |
| `frontend/package.json` / lock | 新增 unplugin-vue-components；vite 7.3.7（Rolldown panic 规避） |
| 57 个页面/组件 | el-empty → PageState；38 个 page-header → PageToolbar |

## 5. 复验方式

1. 浏览器打开 `https://192.168.1.73` → **Ctrl+Shift+R**；
2. 点菜单切换页面：顶部出现细进度条、标题变为"页面名 · TBM-MES"、内容回到顶部；
3. 地址栏输入 `/not-a-real-page` → 显示 404 页（返回首页/上一页）；
4. DevTools Network 设 Offline → 顶部出现离线横幅，恢复后消失；
5. 弱网/重复点击导致多请求失败时，错误提示不再刷屏；
6. 手机/窄屏（≤375px）打开列表与弹窗，弹窗不超出屏幕、表格可横向滚动；
7. 人为让某页面组件抛错（或断网后进入依赖数据页）→ 应看到统一"页面渲染失败"状态与"重新加载页面"，而非白屏；
8. 各页面顶部标题/工具栏间距、空态与加载态应一致；图标按钮悬停有 title/读屏有 aria-label。
