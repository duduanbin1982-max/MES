# 仪表盘（Dashboard）模块审计报告

> 审计对象：factory-mes 自研「首页驾驶舱 / 仪表盘」模块  
> 审计日期：2026-11-02  
> 审计方式：代码走读 + 数据核对 + 接口实测（8 角色权限矩阵）+ 性能测量 + 测试/文档检查  
> 生产环境：192.168.1.73，数据量：实例 5 / 工单 4 / 工序节点 170 / BOM 行 83 / 关键件 11 / 物料 36

## 0. 结论摘要

**总体评级：B-（可用、性能好、结构已收敛；但权限边界、口径一致性、信号有效性有明显缺陷）**

| 维度 | 评价 | 说明 |
|---|---|---|
| 功能完整性 | 良好 | 8 个板块：KPI、健康检查、项目风险、OEE、现场状态、长交期、延误明细、告警聚合 |
| 性能 | 优秀 | 热态 2–4ms，最大响应体 5.4KB；冷启首次 9–12ms |
| 数据自洽 | 良好 | 风险合计 = 各项之和；`by_status` 求和 = 总数；三处延误数字一致（128） |
| 权限边界 | **差** | 4 个接口无权限规则，welder/worker 可越权读取健康检查与风险汇总 |
| 口径一致性 | **差** | 延误"128 条全部 critical"、长交期 12 周 vs 16 周两套阈值、利用率两套定义 |
| 可维护性 | 中 | 视图化收敛做得好；但有 3 个死接口、2 个只为死接口存在的视图 |
| 测试 | 中 | 有理赔与延误测试，但 10 个接口中 4 个无契约测试 |

**最需要立即处理的 3 件事**：① 补 4 个接口的权限规则（10 分钟）；② 延误信号分级失效（128/128 都是 critical，KPI 永久"高风险"）；③ 长交期 12 周/16 周双阈值。

---

## 1. 审计范围

### 1.1 前端

| 文件 | 作用 | 代码行 |
|---|---|---|
| `frontend/src/views/Dashboard.vue` | 页面编排、8 路并行请求、部分失败降级 | 300 |
| `frontend/src/views/dashboard/DashboardHero.vue` | 标题/更新时间/刷新 | 84 |
| `frontend/src/views/dashboard/DashboardKpiGrid.vue` | 4 张 KPI 卡 | 120 |
| `frontend/src/views/dashboard/ProcessHealthCard.vue` | 全流程健康检查（8 环节） | 150 |
| `frontend/src/views/dashboard/DashboardProjectRisk.vue` | 风险来源分布 | 140 |
| `frontend/src/views/dashboard/DashboardInstanceRiskTables.vue` | 最近实例 / 长交期 / 延误明细 | 120 |
| `frontend/src/views/dashboard/DashboardOeeLive.vue` | OEE 与现场实时 | 110 |
| `frontend/src/views/dashboard/dashboardFormat.ts` | 数字/百分比格式化 | 30 |

### 1.2 后端

| 文件 | 作用 |
|---|---|
| `services/reportService/dashboard.js`（217 行） | 5 个接口：`/dashboard`、`/risk-summary`、`/long-leadtime`、`/live-status`、`/process-health` |
| `services/reportService/schema.js`（199 行） | 8 个只读视图（read model） |
| `services/delayAlerts.js`（59 行） | 2 个接口：`/dashboard/delays`、`/dashboard/delays/summary` |
| `services/dashboardAlerts.js`（50 行） | 1 个接口：`/dashboard/alerts`（**前端未使用**） |
| `app/processHealth.js` | 8 环节评分规则（健康分） |
| `middleware/apiPermissions.js:87` | 仅覆盖 `/dashboard`、`/alerts`、`/delays` 的权限规则 |

### 1.3 依赖的其它模块（读）

`equipment_instances`、`work_orders`、`process_nodes`、`work_order_operations`、`instance_bom`、`material_movements`、`serial_numbers`、`qc_inspections`、`work_order_qc`、`weld_records`、`ndt_records`、`assembly_records`、`documents`、`instance_milestones`、`delivery_orders`、`acceptance_records`、`project_cost_entries`、`instance_eco`、`field_service`、`key_components`、`materials`。

> 说明：跨域读已在 2026-11-02 收敛到 8 个视图，本模块不再直接 SELECT 别人的表（这一点是本次审计中做得最好的部分）。

---

## 2. 发现清单

| 编号 | 级别 | 问题 | 影响 |
|---|---|---|---|
| F-01 | **P1** | 4 个仪表盘子接口无权限规则（`risk-summary` / `long-leadtime` / `live-status` / `process-health`） | welder、worker 越权读取健康检查与风险汇总（含合同有无、成本/交付/验收计数） |
| F-02 | **P1** | 延误信号分级失效：128 条延误全部 critical，KPI 永久"高风险" | 风险卡失去区分度；管理者无法判断哪条真该处理 |
| F-03 | **P1** | 长交期双阈值：风险口径 ≥12 周（6 条），告警口径 ≥16 周（3 条） | 同一看板两个"长交期"数字 |
| F-04 | **P2** | 2 个死接口（`/dashboard/long-leadtime`、`/dashboard/live-status`）+ 1 个命名错位（`/dashboard/alerts` 被甘特图页调用） | 维护成本 + 文档误导 + 2 个视图白维护 |
| F-05 | **P2** | 静默失败：后端 `safeAll/safeGet` 吞异常返回 0；前端健康检查失败不提示 | 数据库/视图异常时看板显示"全 0"仍 200，无法察觉 |
| F-06 | **P2** | 时区口径混用：`planned_end` 为本地班次时间（如 08:00），比较基准 `datetime('now')` 是 UTC | 延误最多少算 8 小时；`today` 字段在凌晨显示前一天 |
| F-07 | **P2** | 利用率两套定义混用：OEE 工时利用率（0%）与设备忙闲率（14%），分母分别是 9 工位 / 7 设备 | KPI 标题"设备利用率"语义模糊；`\|\|` 回退掩盖差异 |
| F-08 | **P2** | 数据质量：127/170 工序的计划完成时间在 2026-07~09（排程未维护或生成即过期） | "延误 128" 主要是"计划过期未开工"，不是执行延误 |
| F-09 | **P2** | 端点契约测试缺失：10 个接口中 4 个无测试；权限矩阵无测试 | 权限/口径回退无护栏 |
| F-10 | **P2** | 计数口径不严：`instances_total` 含归档实例；`equipment_models` 未按 `is_active` 过滤（`equipment_types` 有） | 归档后 KPI 与列表页不一致 |
| F-11 | P3 | `/dashboard` 已内联 `risk_summary`，前端仍单独请求 `/risk-summary` | 每次加载多一次视图查询（约 2ms） |
| F-12 | P3 | 无自动刷新（仅挂载时加载一次），OEE/现场状态不会自行更新 | "驾驶舱"实为快照，需手点刷新 |
| F-13 | P3 | 风险等级阈值硬编码（≥10 danger / ≥4 warning），无配置与文档 | 阈值调整需改代码 |
| F-14 | P3 | 扩展性：健康指标视图每实例约 32 个相关子查询；延误视图对 `work_orders/process_nodes` 全表扫描 | 当前 5 实例无压力；实例/节点上千后线性变慢 |
| F-15 | P3 | 路由 `/dashboard` 无 `meta.requires`，仅靠菜单按 `cockpit:report:read` 隐藏 | 低权限用户直接输 URL 可进页面（随后半屏 403） |
| F-16 | P3 | `process-health?instance_id=` 传不存在的实例返回 200 + 0 分 | 深链写错时显示"0 分"而非"实例不存在" |

---

## 3. 逐项详述

### F-01【P1】4 个仪表盘子接口无权限规则——越权读取

**证据**：`middleware/apiPermissions.js:87`

```js
match(/^\/dashboard(?:\/alerts|\/delays|\/delays\/summary)?$/, READ, ["report:read"]),
```

该正则只匹配 `/dashboard`、`/dashboard/alerts`、`/dashboard/delays`、`/dashboard/delays/summary`。
`/dashboard/risk-summary`、`/dashboard/long-leadtime`、`/dashboard/live-status`、`/dashboard/process-health` **不匹配任何规则**，落到 `if (!rule)` 分支（`apiPermissions.js:213-222`）→ 非 warehouse 角色直接放行。

**实测（8 角色 × 10 接口）**：

| 接口 | admin | planner | sales | qc | **welder** | **worker** | warehouse |
|---|---|---|---|---|---|---|---|
| `/api/dashboard` | 200 | 200 | 200 | 200 | **403** | **403** | 403 |
| `/api/dashboard/risk-summary` | 200 | 200 | 200 | 200 | **200 ⚠** | **200 ⚠** | 403 |
| `/api/dashboard/long-leadtime` | 200 | 200 | 200 | 200 | **200 ⚠** | **200 ⚠** | 403 |
| `/api/dashboard/live-status` | 200 | 200 | 200 | 200 | **200 ⚠** | **200 ⚠** | 403 |
| `/api/dashboard/process-health` | 200 | 200 | 200 | 200 | **200 ⚠** | **200 ⚠** | 403 |
| `/api/dashboard/alerts` | 200 | 200 | 200 | 200 | 403 | 403 | 403 |
| `/api/dashboard/delays` | 200 | 200 | 200 | 200 | 403 | 403 | 403 |
| `/api/dashboard/delays/summary` | 200 | 200 | 200 | 200 | 403 | 403 | 403 |
| `/api/key_components/long_leadtime` | 200 | 200 | **403** | 200 | 403 | 403 | 200 |
| `/api/equipment/live_status` | 200 | 200 | 200 | 200 | 403 | 403 | 200 |

**泄露内容**：`process-health` 响应 5.4KB，包含每个实例的健康分、8 环节计数——其中 `has_contract`（合同号有无）、`cost_entries`/`cost_types`（成本台账规模）、`delivery_orders`/`acceptance_records`（交付/验收单数）属于管理层信息。welder 角色（车间焊工）不应看到。

**根因**：新子接口是 2026-10-19 起陆续加的，权限规则没有同步扩展；`apiPermissions` 的"无规则即放行"兜底策略让遗漏变成越权。

**建议**：正则补齐 4 个路径（并加一条"未匹配规则时默认拒绝"的受控白名单测试）。工作量 10 分钟 + 测试 20 分钟。

---

### F-02【P1】延误信号分级失效：128 条全部 critical

**证据**：

| 数据源 | 结果 |
|---|---|
| `/api/dashboard/risk-summary` | `total=135`, `level=高风险`, `delays=128`（wo 1 + pn 127） |
| `/api/dashboard/delays` | `total=128`, `by_severity={"critical":128,"high":0,"warning":0}` |
| 工序节点状态 | completed 4 / in_progress 4 / pending 83 / ready 79 |
| 工序 `planned_end` 样例 | `2026-09-09 08:00:00`、`2026-07-09 08:00:00`、`2026-07-01 04:00:00`（均早于审计日 2026-11-02 两三个月） |

**三个问题叠加**：

1. **severity 分级形同虚设**：`severityOf(d)` 按超期天数分 critical(>7d)/high(3–7d)/warning(0–3d)，但 127 个工序都超期数十天 → 全部 critical，筛选器无用。
2. **风险等级永久红**：`buildRiskSummary` 阈值 `total >= 10 ? danger`，当前 135 → 永远"高风险"。风险卡从"预警工具"退化为"常量"。
3. **口径混淆"未开工过期"与"执行超期"**：127 条中 162 个节点里 83 pending + 79 ready 都没有开工，它们只是"计划日期已过"。真正的执行超期节点是 `in_progress` 中 4 个里的一部分。

**建议**（需业务确认口径）：
- 延误拆两级：**执行中超期**（`status='in_progress' AND planned_end < now`）作为主 KPI；**未开工已过期**单列并归因"排程待重排"。
- severity 用"超期天数分位"或按节点状态着色，而不是全部 critical。
- 风险等级阈值改为可配置（见 F-13），或改为"风险占比"（如超期节点占比 > 30% 才 danger）。

---

### F-03【P1】长交期双阈值：12 周 vs 16 周

| 位置 | 阈值 | 当前结果 |
|---|---|---|
| `reportService/schema.js:26`（`v_risk_counts.long_leadtime`） | `>= 12 周` | **6 条** |
| `reportService/dashboard.js:119`（`/dashboard/long-leadtime`） | `>= 12 周` | 6 条 |
| `materialService/catalogRoutes.js:21`（前端实际调用） | `>= 12 周` | 6 条 |
| `dashboardAlerts.js:28`（`/dashboard/alerts`） | **`>= 16 周`** | **3 条** |

同一业务概念两个阈值。如果以后把 `/dashboard/alerts` 接回前端（它的 `alerts` 数组本来就设计给看板用），会直接出现"长交期 6 条"和"长交期提示 3 条"并存。

**建议**：统一为两档（12 周=风险、16 周=紧急），视图里同时输出 `long_leadtime_12w` / `long_leadtime_16w`，告警只用 16 周档并改文案为"紧急长交期"。

> **附带发现**：延误口径两处 SQL 不对称——`v_risk_counts` 对工序节点排除 `cancelled`（`status NOT IN ('completed','cancelled')`），而 `delayAlerts` 只排除 `completed`（`status NOT IN ('completed')`）。当前 `process_nodes` 没有 `cancelled` 状态，所以数字一致（128=128）；一旦工序引入"已取消"状态，两处会分叉，且明细列表还会多出已取消节点。

---

### F-04【P2】2 个死接口 + 1 个命名错位接口 + 2 个只为死接口存在的视图

| 接口 | 前端引用 | 结论 |
|---|---|---|
| `/api/dashboard/long-leadtime` | 无（前端用 `/key_components/long_leadtime`） | **死接口** |
| `/api/dashboard/live-status` | 无（前端用 `/equipment/live_status`） | **死接口** |
| `/api/dashboard/alerts` | 仅 `views/Gantt.vue:261` 调用（甘特图页，不是仪表盘） | 有人用，但**命名/归属错位**（甘特页调 dashboard 前缀接口，权限也按 report:read 卡） |

连带：`v_long_leadtime_components`、`v_instance_live_status` 两个视图只被两个死接口使用（`docs/read-model.md:36-38` 却写着它们是"消费方"）→ 文档与实现不一致。

另外 `live-status` 的视图是"在 `v_instance_health_metrics` 上收敛一层"，但只取 6 列，却要付出整张健康指标视图（每实例 ~32 个子查询）的代价——实测冷启 10ms。

**建议**：
- 删 2 个死接口 + 2 个视图，同步 `docs/read-model.md`；
- `/dashboard/alerts` 迁到 `/alerts`（或甘特图改用 `/exceptions`），并统一长交期阈值（见 F-03）。

---

### F-05【P2】静默失败：异常被吞成 0

**后端**（`dashboard.js:17-31`）：

```js
function safeAll(sql, params = []) { try { return all(sql, params) } catch (_error) { return [] } }
function safeGet(sql, params = []) { try { return get(sql, params) || null } catch (_error) { return null } }
```

若视图被误删 / 表结构漂移，`/api/dashboard` 会返回 `200` + 全 0，前端显示"0 实例 0 工单"，看不出是故障。

**前端**（`Dashboard.vue:101-113`）：健康检查单独 `try/catch` → 失败时 `{instances:[], selected:null}`，卡片显示空表"暂无体检数据"；而其它 8 个请求失败会进 `partialErrors` 顶部黄条提示 → **提示机制不一致**。

**建议**：
1. 后端捕获异常时累加 `degraded.violations`，响应加 `degraded: true` + `errors: [视图名]`；
2. 前端把 process-health 失败纳入 `partialErrors`；
3. 加一条"视图缺失时接口应返回 500 或 degraded 标记"的测试。

---

### F-06【P2】时区口径：本地班次时间 vs UTC

**证据**：
- `process_nodes.planned_end` 实际值带班次时间（`08:00:00`、`04:00:00`、`12:00:00`），明显是**本地时间**；
- 视图与接口的比较基准是 `datetime('now')`（SQLite 默认 **UTC**）与 `new Date().toISOString()`（UTC）；
- 服务器时区 Asia/Shanghai（UTC+8）。

**后果**：一个本地时间 08:00 到期的节点，在本地 16:00 前都不会被判超期——最多少算 8 小时。
另外 `risk_summary.today`、`delays.today` 用 UTC 日期字符串，凌晨 00:00–08:00 本地会显示"昨天"。

**建议**：确认 `planned_end` 的生成口径（是本地时间就统一用 `datetime('now','localtime')` 比较），并在视图注释与文档里写明；可能影响所有延误数字，需业务确认后一次性切换。

---

### F-07【P2】利用率两套定义混用

| 来源 | 计算 | 当前值 | 分母 |
|---|---|---|---|
| `/api/equipment/oee` | 工时：`fleet_busy_hours / fleet_available_hours` | **0%**（无报工工时） | 9 工位 |
| `/api/equipment/live_status` | 忙闲比：`(总-闲)/总` | **14%**（忙 1 / 闲 6 / 总 7） | 7 台设备 |

前端（`Dashboard.vue:135`）：

```ts
const fleetUtilization = computed(() => Number(oee.value.summary?.fleet_utilization_pct || live.value.utilization || 0))
```

`||` 让 0 被当作"缺失"回退到 live 值，于是卡片显示 14%，副标题"1 忙 / 6 闲 / 7 总"也自洽——**今天看不出问题**；一旦 OEE 有 1% 报工工时，卡片会显示 1%，副标题仍是 1 忙 6 闲（14%），矛盾立刻暴露。

**建议**：拆成两个指标（"工时利用率"与"设备开动率"），或保留一个但明确文案与分母，禁止 `||` 混用。

---

### F-08【P2】数据质量：127/170 工序计划时间已过期

工序节点中 162 个（83 pending + 79 ready）从未开工，其中 127 个 `planned_end` 在 2026-07~09。这是"排程未维护"或"排程生成时用了过去日期"。它直接导致 F-02 的信号失效。

**建议**：业务侧重排程（把过期未开工节点的计划时间后移或标记"待重排"），并在排程生成逻辑里禁止生成过去日期。

---

### F-09【P2】测试覆盖

| 测试文件 | 覆盖 | 评价 |
|---|---|---|
| `tests/dashboardRiskSummary.test.js` | `/dashboard`、`/risk-summary` 的数字与风险合计 | 好，但只覆盖 2 个接口 |
| `tests/delayAlerts.test.js` | `/dashboard/delays`、`/delays/summary` 的排序与 severity | 好 |
| `tests/readModelViews.test.js`（9 条） | 8 个视图 + 重建场景 | 好（视图层） |
| `tests/processHealth.test.js`（13 条） | 8 环节评分规则 | 好（逻辑层） |

**缺口**：`/dashboard/long-leadtime`、`/dashboard/live-status`、`/dashboard/process-health`、`/dashboard/alerts` **无端点契约测试**；**无权限矩阵测试**（正是 F-01 能溜进来的原因）。

**建议**：加一个 `tests/dashboardApiContract.test.js`：用固定角色的 token 断言 10 个接口的 200/403 矩阵 + 关键字段存在性。

---

### F-10【P2】计数口径不严

| 指标 | 现状 | 风险 |
|---|---|---|
| `instances_total` | `SELECT COUNT(*) FROM equipment_instances`（不过滤 `archive_status`） | 归档实例计入"项目总数"，与列表页（同样不过滤，但未来若加过滤就会不一致） |
| `equipment_models` | 全部型号，无 `is_active` 过滤 | 与 `equipment_types`（`is_active=1`）口径不一致 |
| `bom_total` | 全部 BOM 行（含未挂物料） | 与健康检查"BOM 行"口径一致，可接受 |

---

### F-11 ~ F-15（P3）

- **F-11 重复请求**：`/dashboard` 响应已含 `risk_summary`，`Dashboard.vue:250-258` 仍并行请求 `/risk-summary`。可少一次请求。
- **F-12 无自动刷新**：`onMounted` 只调一次 `loadAll()`；`DashboardHero` 的"刷新"是手动。驾驶舱类页面通常需要 30–60s 轮询或 WS 推送（系统已有 `/ws` 通道）。
- **F-13 阈值硬编码**：`buildRiskSummary` 的 10/4 两个魔法数；建议进 `app/processHealth.js` 同级配置或 settings 表。
- **F-14 扩展性**：`v_instance_health_metrics` 每实例约 32 个相关子查询；延误视图对 `work_orders`/`process_nodes` 全表扫描。当前数据量下总耗时 2–4ms，实例/节点上千后需改为预聚合表或按实例分页。
- **F-15 路由未加权限**：菜单按 `cockpit:report:read` 隐藏仪表盘，但 `/dashboard` 路由无 `meta.requires`，直接输 URL 可进（随后大部分接口 403、页面半残）。
- **F-16 未知实例静默返回 0 分**：`GET /api/dashboard/process-health?instance_id=999` 返回 `200` + `selected.summary.score = 0 / grade = blocked / stages = []`，深链写错实例号时页面显示"0 分"而不是"实例不存在"。

---

## 4. 数字自洽性核对（全部通过）

| 核对项 | 结果 |
|---|---|
| 风险合计 = 延误 + 长交期 + ECO + 服务工单 | 135 = 128 + 6 + 1 + 0 ✅ |
| `/dashboard.risk_summary.total` = `/risk-summary.total` | 135 = 135 ✅ |
| 风险视图延误 = 延误汇总接口 | 128 = 128（wo 1 + pn 127）✅ |
| 延误明细 `total` = 汇总 `total` | 128 = 128 ✅ |
| `work_orders.by_status` 求和 = 总数 | 4 = 4 ✅ |
| `process_nodes.by_status` 求和 = 总数 | 170 = 170 ✅ |
| `instances.by_status` 求和 = 总数 | 5 = 5 ✅ |
| 长交期：风险计数 = 明细条数 | 6 = 6 ✅ |
| 健康检查实例数 = 实例总数 | 5 = 5 ✅ |
| 健康分与环节计数自洽（`ok+partial+empty = 8`） | 2+5+1=8 ✅ |

---

## 5. 性能实测

| 接口 | 冷启首次 | 热态 | 响应体 |
|---|---|---|---|
| `/api/dashboard` | 9ms | 3ms | 1185B |
| `/api/dashboard/risk-summary` | 2ms | 3ms | 689B |
| `/api/dashboard/process-health` | 3ms | 3ms | 5442B |
| `/api/dashboard/long-leadtime` | 3ms | 3ms | 799B |
| `/api/dashboard/live-status` | 3ms | 2ms | 876B |
| `/api/dashboard/delays?limit=5` | 4ms | 3ms | 1525B |
| `/api/dashboard/delays/summary` | 3ms | 2ms | 91B |
| `/api/equipment/oee?days=14` | 3ms | 3ms | 1892B |

**结论**：当前数据量下性能无问题（页面 9 个请求合计约 25ms、~13KB）。**但要注意**：视图层每实例 32 个子查询、延误口径全表扫描，属于"数据量小时看不出来"的写法，需在节点/实例上量前改造。

---

## 6. 做得好的地方（应保留）

1. **视图化收敛**：跨域 SQL 从 3 个文件收敛到 8 个视图，业务改表只需改一处；
2. **前端降级设计**：8 个请求 `Promise.allSettled` + `partialErrors` 黄条，单点失败不白屏；
3. **健康检查可执行**：8 环节 + `next_actions`（含跳转页），不是只报数字；
4. **数字自洽**：见第 4 节，10 项核对全通过；
5. **响应体克制**：最大 5.4KB，无大列表塞进首页；
6. **文档齐**：`docs/read-model.md`、`docs/business-flow-sop.md`、手册第 3 节均有对应说明（除 F-04 的误导）。

---

## 7. 修复建议（按优先级）

### P1（建议本周内，合计约 1.5 天）

| 项 | 动作 | 工作量 |
|---|---|---|
| F-01 | `apiPermissions.js:87` 正则补 4 个路径；补权限矩阵测试 | 0.5h |
| F-02 | 延误拆"执行中超期/未开工过期"两级；severity 改分档；风险等级阈值可配置 | 1d（需业务确认口径） |
| F-03 | 长交期统一 12 周/16 周两档，视图输出两列，告警用 16 周并改文案 | 0.5d |

### P2（两周内，合计约 2.5 天）

| 项 | 动作 | 工作量 |
|---|---|---|
| F-04 | 删 3 个死接口 + 2 个视图，同步 read-model.md | 0.5d |
| F-05 | 后端 degraded 标记 + 前端 process-health 失败提示 | 0.5d |
| F-06 | 时区口径统一（需业务确认 planned_end 生成来源） | 0.5d |
| F-07 | 利用率拆两个指标，去掉 `\|\|` 混用 | 0.5d |
| F-08 | 127 个过期未开工节点重排程 | 业务侧 1d |
| F-09 | 补 4 个接口契约测试 + 权限矩阵测试 | 0.5d |

### P3（随迭代）

F-10 计数口径、F-11 去重复请求、F-12 加轮询/WS 刷新、F-13 阈值配置化、F-14 扩展性预研、F-15 路由加 `meta.requires`。

---

## 8. 附录：证据

| 文件 | 内容 |
|---|---|
| `evidence/dashboard-backend.txt` | `dashboard.js` / `schema.js` / 测试 / 权限规则全文 |
| `evidence/dashboard-frontend.txt` | `Dashboard.vue` 与 8 个组件源码 |
| `evidence/dashboard-probe.txt` | 8 角色 × 10 接口权限矩阵、响应时间、三处延误数字对照 |
| `evidence/dashboard-semantics.txt` | planned_end 形态、状态分布、风险视图 vs 手算、索引覆盖 |
| `evidence/dashboard-perf.txt` | 冷/热态耗时与响应体大小 |
| `evidence/dashboard-usage.txt` | 4 个子接口的前端/文档/测试引用情况 |
| `evidence/dashboard-menu.txt` / `dashboard-home.txt` | 菜单权限策略与角色默认落地页 |
| `evidence/dashboard-util.txt` | OEE 与 live_status 利用率对照 |

---

## 9. 整改记录（2026-11-02 当晚）

业务确认口径「延误要区分已开工超期和未开工计划过期」后，3 个 P1 + F-04 一半已整改（提交 `7325322`）。

| 发现 | 整改内容 | 结果 |
|---|---|---|
| **F-01** 权限缺口 | `apiPermissions.js:87` 正则补 `risk-summary` / `long-leadtime` / `live-status` / `process-health`；新增 `tests/apiPermissionsDashboard.test.js`（8 接口 × 7 角色矩阵） | welder/worker 由 **200 → 403**；planner/qc/sales 仍 200 ✅ |
| **F-02** 延误信号失效 | 延误拆三档：已开工超期（in_progress/paused）/ 未开工计划过期（pending/ready）/ 受阻；风险合计只算执行风险，未开工过期单列 backlog | 风险合计 **135 → 12**（执行中超期 5 + 长交期 6 + ECO 1）；延误明细仍 128（5 + 123）✅ |
| **F-03** 长交期双阈值 | 风险视图同时输出 12 周 / 16 周两档；前端 ≥16 周标「紧急」 | 12 周 6 条 / 16 周 3 条，文案区分「紧急」✅ |
| **F-04** 一半 | `/api/dashboard` 补 `instances.by_type`（新增视图 `v_instance_type_counts`）；前端「装备类型」饼图不再空白 | 返回 `[{"type":"盾构机/掘进机","c":5}]` ✅ |

**仍待整改**（按审计建议顺序）：

| 级别 | 未完成项 |
|---|---|
| P2 | F-04 剩余（删 2 个死接口 + 2 个视图、`/dashboard/alerts` 迁出 dashboard 前缀） |
| P2 | F-05 静默失败（degraded 标记 + 前端健康检查失败提示） |
| P2 | F-06 时区口径（planned_end 本地时间 vs UTC 比较，最多少算 8h） |
| P2 | F-07 利用率两套定义（OEE 工时利用率 vs 设备忙闲率） |
| P2 | F-08 数据质量（127 个工序的计划时间在 7–9 月，需业务重排程） |
| P2 | F-10 计数口径（归档实例 / equipment_models 的 is_active） |
| P3 | F-11 去重复请求、F-12 自动刷新、F-13 阈值配置化、F-14 扩展性、F-15 路由权限、F-16 未知实例 404 |

**整改后评级**：B（原 B-）。权限与口径两个 P1 已消除，剩余均为体验/一致性/数据质量问题。

**证据**：`git log 7325322`；`docs/delay-definition.md`（两档口径全文）；`tests/apiPermissionsDashboard.test.js`。