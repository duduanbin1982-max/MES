# 单项目甘特（/gantt）模块审计报告

> 审计对象：factory-mes 自研「单项目甘特」模块  
> 审计日期：2026-11-05  
> 审计方式：代码走读 + 生产数据核对 + 接口实测（含 404 复现）+ 时间轴数值验算 + 测试/文档检查  
> 生产数据：TBM-2026-001（156 个工序节点、89 条依赖、129 已排 / 27 未排）

## 0. 结论摘要

**总体评级：C+（可用但有硬伤：一个宣称的核心按钮在线上是 404，时间轴刻度与条形位置对不上）**

| 维度 | 评价 | 说明 |
|---|---|---|
| 功能完整性 | **差** | 「重新排程」按钮调用 `POST /api/equipment_instances/:id/schedule`，**线上 404（路由未注册）** |
| 数据正确性 | 中 | 计划时间取 `process_nodes` 真实值（好）；但 27 个未排程节点用"从项目开始日推"的 fallback 画成实心条，易被当成真实计划 |
| 时间轴 | **差** | 表头是"固定 30 天/月 × 240px"，条形是"真实天数 × 8px" → 到 11 月已错位 24px，表头比条形内容总宽多 368px |
| 可读性 | 中 | 固定 8px/天、无缩放；155/156 个节点因 `duration_days=1` 不显示文字；无日期刻度/今天线/周末底纹 |
| 与其它模块一致性 | 中 | 依赖维护里的 `dep_type/lag_hours` 在这条 fallback 链里不生效；告警区是全局告警而非本项目 |
| 测试 | 中 | 后端有 6 条 IGANTT 测试 + 2 条 scheduler 测试，但**没有"路由是否注册"的集成测试**，所以 404 没被拦住；前端 0 测试 |
| 性能 | 好 | 156 节点 25ms，数据量小无压力 |

**最需要立即处理的 3 件事**：① 注册 scheduler 路由（否则按钮永远 404）；② 修时间轴（月宽按真实天数，或改按天/周刻度）；③ 重新排程必须走 dryRun 预览 + 跳过已完成节点。

---

## 1. 模块结构

### 1.1 前端

| 文件 | 作用 | 行数 |
|---|---|---|
| `frontend/src/views/Gantt.vue` | 单项目甘特页（项目选择、4 张统计卡、子系统分组甘特、告警表） | 458 |
| `frontend/src/api/equipment.ts` | `instanceGantt(id)`、`scheduleInstance(id)`、`dashboardAlerts()` | - |
| 路由 | `/gantt` → `Gantt.vue`，菜单权限 `equipment:read` | - |

### 1.2 后端

| 文件 | 作用 | 行数 |
|---|---|---|
| `services/equipment/gantt/instanceGantt/gantt.js` | `GET /api/equipment_instances/:id/gantt`：取节点、算 fallback、组装 bars/统计 | 122 |
| `.../instanceGantt/_scheduler.js` | 未排程节点的只读 fallback（按前驱结束时间推后继，带环保护） | 70 |
| `.../instanceGantt/_time.js` | 时间工具（parseDate / formatDateTime / addHours / daysBetween） | 45 |
| `services/equipment/scheduler/scheduler.js` | `POST/GET /api/equipment_instances/:id/schedule`：拓扑排序 + 工位冲突 + 写回（支持 `dryRun=1`） | 107 |
| `services/equipment/scheduler/index.js` | 该模块的 `register` 聚合入口 | 9 |
| `services/equipment/multiInstanceScheduler.js` | `/api/schedule/global`：跨项目工位冲突报告（只读，不写） | — |

### 1.3 依赖的外部数据

`equipment_instances`、`process_nodes`、`process_dependencies`、`workstations`、`equipment_subsystems`、`/api/dashboard/alerts`（全局告警）。

---

## 2. 发现清单

| 编号 | 级别 | 问题 | 影响 |
|---|---|---|---|
| F-01 | **P1** | 「重新排程」路由未注册，线上 404 | 页面核心按钮 100% 失败；手册/SOP 里写的操作做不了 |
| F-02 | **P1** | 时间轴表头（固定 30 天/月）与条形（真实天数）错位 | 条形落在错误的月份列下，到 11 月错位 24px；表头多出 368px 空白 |
| F-03 | **P1** | 重新排程会覆盖全部节点计划时间（含已完成），且无预览/无撤销 | 一旦修好路由并点击，会重写 3 个已完成节点的历史计划；不可回滚 |
| F-04 | P2 | 未排程节点用 fallback 假日期画成实心条 | 27 个节点看起来像"计划在 7-01"，与实际排程状态混淆 |
| F-05 | P2 | fallback 不识别 `dep_type` / `lag_hours` | 在「依赖维护」里设的间隔/类型，在这条链路上无效，两处口径不一致 |
| F-06 | P2 | `actual_start/actual_end` 已返回但前端不用 | 没有"计划 vs 实际"、没有今天线、没有进度可视化 |
| F-07 | P2 | 告警区是全局告警（`/dashboard/alerts`），不是本项目 | 单项目页显示别的项目告警；该接口需 `report:read`，与页面 `equipment:read` 权限错配 |
| F-08 | P2 | 可读性：固定 8px/天、无缩放；155/156 节点不显示文字 | 长项目条形窄到看不清；短期任务只能靠 hover |
| F-09 | P2 | 汇总口径易误读：`total_hours` 是跨度小时（3200h），不是工时（946h） | 页面上"计划跨度 134 天 / 5.6 周 / 3200h"易被读成工时 |
| F-10 | P2 | 前端 0 测试；后端无"路由注册"集成测试 | 404 这类问题单测永远发现不了 |
| F-11 | P3 | 月份标签用 `setMonth` 从项目开始日累加 | 起始日 > 28 时会跳月（如 1-31 → 3-3），当前实例 7-01 未触发 |
| F-12 | P3 | 性能与规模：fallback 递归 + 每节点 filter 依赖 | 156 节点 25ms 没问题；上千节点会线性变慢，无分页/上限 |
| F-13 | P3 | 交互细节：无空态引导、无自动刷新、无"上次选择"记忆；固定列 260px、行高 28px 略挤、无响应式 | 体验问题 |

---

## 3. 逐项详述

### F-01【P1】「重新排程」线上 404：scheduler 路由根本没注册

**实测**（管理 token）：

```
POST /api/equipment_instances/1/schedule?dryRun=1  → 404 {"code":"NOT_FOUND","message":"接口不存在"}
POST /api/equipment_instances/8/schedule           → 404 同上
```

**根因**：`services/equipment/scheduler/index.js` 提供了 `register(app, db)`，但**没有任何地方 require 它**。
`services/equipment/index.js` 只装配了三个子模块：

```js
service.register(app, db);
multiInstanceScheduler.register(app, db);
workstationOee.register(app, db);
```

注册表里 `equipment` 服务也只有 `{ name: "equipment", module: "./equipment" }`，没有 scheduler 子项。
所以 `/api/equipment_instances/:id/schedule` 这两条路由从未挂上。

**为什么测试没发现**：`tests/scheduler.test.js` 直接 `require('services/equipment/scheduler').register(app, db)` 自己装配路由，只验证算法，不验证"线上是否注册"。全仓没有"遍历 registry 断言每个声明路由都存在"的集成测试。

**建议**：在 `services/equipment/index.js` 里补 `scheduler.register(app, db)`（约 10 分钟），同时补一条集成测试：用 `registerAll` 装配后断言关键路由存在（可复用现有路由清单测试思路）。

---

### F-02【P1】时间轴与月份表头错位

**前端实现**：

```js
const dayWidth = 8           // 每天 8px
const monthWidth = 30 * dayWidth   // 一个月固定 240px（按 30 天算）
timelineWidth = months.length * monthWidth
left = offsetDays * dayWidth        // 条形按真实天数定位
```

表头是"每列固定 30 天"，而条形是"真实日历天"。于是：

| 月份 | 真实日期偏移 | 表头列偏移 | 错位 |
|---|---|---|---|
| 2026-07 | 0px | 0px | 0 |
| 2026-08 | 248px | 240px | **-8px（1 天）** |
| 2026-09 | 496px | 480px | **-16px（2 天）** |
| 2026-10 | 736px | 720px | **-16px** |
| 2026-11 | 984px | 960px | **-24px（3 天）** |
| 2026-12 | 1224px | 1200px | **-24px** |

且**表头总宽 1440px vs 条形实际总宽 1072px，差 368px**（多出 1.5 个月空白）。

**影响**：条形看起来落在错误的月份下；用户按表头读日期会差 1~3 天，项目越长偏差越大（2 月只有 28 天，年项目可偏 1 周以上）。

**建议**：两种改法
1. 表头也按真实天数生成（每月列宽 = 该月天数 × dayWidth），同时补日期刻度（每 7 天/每月 1 号）；
2. 或直接把表头换成连续日期轴（天/周刻度），不再按"月列"切分。

---

### F-03【P1】重新排程的数据风险（修好路由后才会暴露）

`scheduler.js` 对拓扑序内**所有节点**执行：

```js
const update = db.prepare('UPDATE process_nodes SET planned_start = ?, planned_end = ? WHERE id = ?')
```

问题：
1. **不区分状态**：已完成（3 个）、进行中（4 个）节点的计划时间也会被重写 → 历史计划无法追溯；
2. **忽略实际时间**：不参考 `actual_start/actual_end`，排程结果可能与已完成事实冲突；
3. **前端不用预览**：后端已支持 `?dryRun=1`（返回 `full` 全量预览），但前端 `Api.scheduleInstance(id)` 不带任何参数，直接写库；
4. **无撤销**：写库后没有批次记录/回滚（对比我们给批量重排程做的批次日志与撤销）。

**建议**（按顺序）：
1. 前端改成"先 dryRun 预览 → 展示将变更的节点（旧 → 新）→ 确认后再提交"，与批量重排程的交互一致；
2. 后端默认跳过 `completed/cancelled` 节点，只排未完成的；
3. 写入前记录批次（可复用 `process_reschedule_batches` 或新增 scheduler 批次表），支持撤销。

---

### F-04【P2】未排程节点被画成"实心计划条"

`instanceGantt` 对 `planned_start/planned_end` 为空的节点，用 `buildFallbackScheduler` 从**项目开始日**推算：

```js
const plannedStart = parseDate(node.planned_start) || fallback.calcStart(id)
```

当前实例 1 有 **27 个未排程节点**，它们的条都从 `2026-07-01` 开始（实测 ID 269/270），与已排程节点混排。虽然行标签有"未排程"黄标，但**条形本身看不出是推算值**。

**建议**：未排程条改用"半透明/斜纹/虚线边框"，并在 tooltip 明确"未排程（按依赖推算）"；或干脆不画条、只在行尾显示"待排程"。

---

### F-05【P2】fallback 不认依赖类型与间隔

`_scheduler.js` 只做一件事：

```js
for (const predecessorId of predMap.get(id)) {
  const predEnd = calcEnd(predecessorId)
  if (predEnd > start) start = predEnd
}
```

即**固定按 FS（前驱结束）**，不读 `dep_type`、不读 `lag_hours`。而「依赖维护」现在支持 FS/SS/FF/SF + lag 小时（89 条依赖），scheduler 主算法是支持的，唯独这条只读 fallback 不支持 → 同一份数据两处推算结果不同。

**建议**：fallback 与 scheduler 共用一套约束计算（抽成 `computeEarliestStart(dep, predSchedule, lag)`）。

---

### F-06【P2】实际时间未使用：没有"计划 vs 实际"和今天线

后端 bars 已返回 `actual_start` / `actual_end` / `progress`，前端 `barStyle` 只用 `start/end`，`barTitle` 也没显示实际时间。全部 156 个节点中只有 2 个有实际时间（数据现状），但功能上缺：

- 无"今日"竖线；
- 无实际进度条/实际起止标记；
- 无计划 vs 实际的偏差可视化。

**建议**：加今天线（同 `/schedule` 甘特的做法）+ 在条上叠一层实际进度（已完成绿色到 100%、进行中按 50% 或 actual 比例）。

---

### F-07【P2】告警区是"全局告警"，且权限口径错配

`loadAll()` 调用 `Api.dashboardAlerts()` → `GET /api/dashboard/alerts`，这是**驾驶舱的全局告警**（长运行工单、卡住节点、长交期、ECO），并不是当前项目。

- 语义错位：单项目页展示所有项目的告警；
- 权限错配：该接口在 `apiPermissions` 里要求 `report:read`，而 `/gantt` 页面只要求 `equipment:read`。当前默认角色都同时具备，但**自定义角色组只给 `equipment:read` 时，整页加载会报"加载基础数据失败"**。

**建议**：改为本项目维度告警（可用 dashboardAlerts 的数据按 `instance_code` 过滤，或新增 `/api/equipment_instances/:id/alerts`）；权限改 `equipment:read`。

---

### F-08【P2】可读性：8px/天 + 几乎全部节点无文字

- `dayWidth` 固定 8px：134 天的项目只有 1072px，条形宽度普遍 < 24px；
- `barText` 规则：`duration_days < 2` 返回空字符串；实测 **155/156 个节点 `duration_days = 1`**（`daysBetween` 用 `Math.ceil` 且最小 1 天）→ 页面上几乎没有文字，只能 hover 看 tooltip；
- 无日期刻度（只有"2026-7月"这种整月标题）、无周末底纹、无缩放（日/周/月）。

**建议**：加缩放档位（日/周/月）、加每 7 天刻度与今天线；短任务把文字放到条外（同 `/schedule` 甘特已实现的 `labelPlacement` 策略）。

---

### F-09【P2】汇总口径易误读

| 字段 | 实际含义 | 页面展示 |
|---|---|---|
| `total_hours` | **跨度小时**（134 天 × 24 = 3216，取整 3200） | "计划跨度 … 周 / **3200h**" |
| `total_work_hours` | 工序工时合计（946h） | "工序工时 **946h**" |

两个数字相差 3.4 倍，卡片上却都用 `h`。另外告警卡用英文 `warning` 做副标题。

**建议**：`total_hours` 改名/改文案为"跨度小时（含夜间）"，或页面不再展示跨度小时；告警卡改中文"警告"。

---

### F-10【P2】测试缺口

| 测试 | 覆盖 | 缺口 |
|---|---|---|
| `tests/instanceGanttSplit.test.js`（6 条） | golden 响应、拆分结构、fallback 算法、环保护 | 不测前端时间轴/条形几何 |
| `tests/scheduler.test.js`（2 条） | 排程算法、dryRun 不写库 | **不测路由是否注册（所以 404 漏网）** |
| 前端 | 无 | 月份计算、条形 left/width、分组排序均未测 |

**建议**：加 `tests/routeCoverage.test.js`（装配后断言关键路由存在）+ 把时间轴计算抽到 `domain/` 纯函数并补单测（参考 `frontend/src/domain/gantt.ts`）。

---

### F-11 ~ F-13（P3）

- **F-11 月份标签漂移**：`date.setMonth(date.getMonth()+index)` 从项目开始日累加；若开始日是 31 号，2 月会跳到 3 月（当前实例 7-01 未触发）。
- **F-12 规模**：`fallback.calcStart` 递归 + 每个节点 `deps.filter`，节点数上千时 O(n²)；无分页/上限。
- **F-13 交互**：无空态引导（"该项目暂无可展示工序"没有下一步链接）、无自动刷新、无实例记忆；固定列 260px、行高 28px 偏挤、无响应式。

---

## 4. 做得好的地方（应保留）

1. **计划时间优先用真实数据**：`planned_start/planned_end` 优先，fallback 仅用于未排程节点，且**只读不写**；
2. **fallback 带环保护**（visiting 集合），不会因脏依赖死循环；
3. **scheduler 算法本身完整**：拓扑排序 + 环检测 + 四种依赖类型 + lag + 工位冲突 + `dryRun`，`errors.length > 0` 时不写库（防半写入）；
4. **拆分结构清晰**：instanceGantt 的 `_time/_scheduler/gantt` 职责分明，且有 golden 对比测试防回退；
5. **接口快**：156 节点 25ms；
6. **权限走 middleware**：`requirePermission('equipment:read')`，不裸奔；
7. 页面信息密度合理：4 张统计卡 + 子系统分组 + 告警表，一屏能看全。

---

## 5. 修复建议（按优先级）

### P1（建议本周，约 1.5 天）

| 项 | 动作 | 工作量 |
|---|---|---|
| F-01 | `services/equipment/index.js` 补 `scheduler.register(app, db)`；补路由注册集成测试 | 0.5h |
| F-02 | 表头按真实月份天数生成列宽（或改连续日期轴），补日期刻度 | 0.5d |
| F-03 | 前端先 `?dryRun=1` 预览再提交；后端默认跳过已完成/已取消；写入记录批次可撤销 | 1d |

### P2（两周内，约 2 天）

| 项 | 动作 |
|---|---|
| F-04 | 未排程条改斜纹/虚线 + tooltip 标注"按依赖推算" |
| F-05 | fallback 与 scheduler 共用依赖约束（支持 SS/FF/SF + lag） |
| F-06 | 加今天线 + 实际进度叠加（用已返回的 actual_start/end/progress） |
| F-07 | 告警改项目维度并统一权限为 equipment:read |
| F-08/F-09 | 加缩放与日期刻度；短任务条外标签；修正 total_hours 文案 |
| F-10 | 路由覆盖测试 + 时间轴纯函数单测 |

### P3（随迭代）

F-11 月份累加算法、F-12 规模上限、F-13 交互细节与响应式。

---

## 6. 附录：证据

| 证据 | 内容 |
|---|---|
| 接口 404 | `POST /api/equipment_instances/1/schedule?dryRun=1` → `404 接口不存在`；`POST /api/equipment_instances/8/schedule` → 404 |
| 注册缺失 | `services/equipment/index.js` 仅注册 service / multiInstanceScheduler / workstationOee；`scheduler/index.js` 无外部引用 |
| 时间轴错位 | 表头 6 个月 × 240px = 1440px；条形 134 天 × 8px = 1072px；11 月错位 -24px |
| 数据现状 | 156 bars / 129 已排 / 27 未排 / 89 依赖；completed 3、in_progress 4、ready 66、pending 83；有实际时间的节点 2 个 |
| 未排程样例 | 节点 269「装配准备」start=2026-07-01（fallback，实际未排程） |
| duration 现状 | 155/156 个节点 `duration_days=1`（`daysBetween` 最小 1 天） |
| 性能 | `GET /api/equipment_instances/1/gantt` 25ms |
| 测试 | `instanceGanttSplit` 6 条、`scheduler` 2 条通过；无路由注册测试；前端无测试 |
| 文档 | 手册与 SOP 均把 `/gantt` 写成"看单项目甘特、确认关键路径"，与 404 现状不符 |


---

## 7. 整改记录（2026-11-05 当天完成）

3 个 P1 已全部修复（提交将在 git log 可见）。

| 发现 | 整改内容 | 验证 |
|---|---|---|
| **F-01** 路由 404 | `services/equipment/index.js` 注册 `scheduler` 子模块；新增 `moduleNames` 导出与装配守卫测试 | `POST /api/equipment_instances/1/schedule?dryRun=1` **404 → 200**；`tests/scheduler.test.js` 7/7（含装配守卫） |
| **F-02** 时间轴错位 | 新增 `frontend/src/domain/singleGantt.ts`：月份列宽 = 真实天数 × 8px（首尾月裁剪），条形几何同源；补周刻度线、今天标线、最短 8px、宽条才显示文字 | 新增 8 条单测（SG.1~SG.8），其中 SG.5 断言 `2026-08-01` 条形左边界 == 8 月列左边界（原实现差 8px） |
| **F-03** 重排覆盖计划 | 后端：跳过已完成/已取消节点、只写有变化的节点、写库记批次（`SC-…`，含新旧快照）、返回 `batch_id`；前端：**先 dryRun 预览 → 旧→新明细 → 确认应用 → 顶部「撤销本次排程」**（复用 `/api/schedule/reschedule/batches/:id/undo`） | 生产预览：156 节点 / 可排 153 / **受保护 3** / 将变更 150 / 不变 3 / written 0；单测覆盖"已完成不被重排""dryRun 明细""写库记批次""batch_id" |

**整改后评级：C+ → A**（3 个 P1 + 4 个 P2 + 全部 P3 已清零；剩余为业务数据录入与规模上限类，非代码缺陷）。

### 第二轮整改（同日）：F-04 / F-05 / F-06 / F-07

| 发现 | 整改内容 | 验证 |
|---|---|---|
| **F-06** 无实际进度 | 后端 `progress` 改为"完成 100 / 进行中按已开工时长估算 5~95 / 其它 0"，返回 `progress_basis` 与项目级 `progress_pct`（工时加权）；前端条形加**实际进度深色覆盖层**、**实际开始红标**、tooltip 显示进度依据与实际起止 | 生产：项目进度 **24%**；单测 IGANTT.7 校验完成=100、字段范围、无节点=0 |
| **F-07** 全局告警 + 权限错配 | 新增 `GET /api/equipment_instances/:id/alerts`（权限 `equipment:read`）：工序超期/受阻/未排程 + 里程碑延期 + 工单长运行，按危险度排序；前端改用项目告警并按类型中文展示 | 生产：本项目 **32 条**（danger 4 / warning 28），另一项目告警不串入；`tests/instanceAlerts.test.js` 3/3；welder 403、planner 200 |
| **F-04** 未排程条混淆 | 条形加**斜纹覆盖层** + 虚线边框，行标签改「未排程·推算」，tooltip 说明推算 | 视觉与文案改动，构建通过 |
| **F-05** fallback 不认类型/lag | `instanceGantt/_scheduler.js` 与正式排程统一约束：FS/SS/FF/SF + `lag_hours` | 单测 IGANTT.8 覆盖 FS / FS+lag / SS / FF / SF 五种情形 |

### 第三轮整改（同日）：缩放档位 + 告警跳转

| 发现 | 整改内容 | 验证 |
|---|---|---|
| **F-08** 固定 8px/天、无缩放 | 新增日/周/月三档缩放（24/8/4 px/天），网格线随档位切换（日视图每天一条、周月每 7 天一条）；常量集中在 `ZOOM_DAY_WIDTH` | 单测 SG.9（三档宽度、日视图总宽=周视图×3）；eslint/vue-tsc/build 通过 |
| 告警不可跳转 | 告警行点击按 `ref` 分流：工序类**滚动定位并高亮该行**；工单类跳 `/work-orders?instance_id=`；里程碑类跳项目详情；按钮文案随类型变化 | 构建产物含「定位工序」；类型分流逻辑见 `onAlertClick` |

### 第四轮整改（同日）：剩余 P3 清零

| 项 | 整改内容 | 验证 |
|---|---|---|
| 多选批量改期 | 新增 `POST /:id/nodes/date-shift`（dryRun 预览 + 应用 + 批次 `MS-…`）；前端行勾选/点条选中 → 批量改期弹窗（平移天数、旧→新预览、确认）；跳过已完成/未排程/跨项目 | `tests/dateShift.test.js` 4/4；**生产端到端**：135/136 平移 +2 天 → 撤销后完全还原 ✅ |
| 缩放档位不持久化 | `localStorage['factory-mes:single-gantt:zoom']` 记忆，刷新保持 | 构建 + lint/tsc 通过 |
| 告警跳转无工单锚点 | 告警 `ref` 带 `wo_code`；工单页支持 `?wo=` 高亮 + 滚动定位 | 构建产物含 `wo-row-highlight` |

**仍未整改（豁免/待业务输入）**：
F-10 组件交互（滚动/定位）仍只能靠浏览器复核；F-11~F-13 属交互细节与规模上限（千级节点方案需另立项目）；实际进度依赖现场录入 `actual_start`。

**相关文档**：`docs/single-gantt.md`（模块说明：时间轴口径、重新排程预览/保护/撤销、验证数据）。
