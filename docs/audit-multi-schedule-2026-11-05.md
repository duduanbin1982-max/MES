# 多项目资源平衡（/multi-schedule）模块审计报告

> 审计对象：factory-mes 自研「多项目资源平衡」模块  
> 审计日期：2026-11-05  
> 审计方式：代码走读（前端 452 行 + 后端 8 个文件约 500 行）+ 生产数据实测（2026-06 / 2026-11 两个窗口）+ 权限实测 + 冲突算法验算  
> 生产数据：5 个项目、9 个工位、156 个工序节点、4 张工单

## 0. 结论摘要

**总体评级：C+（可用，但"资源冲突"里混了大量历史噪声，工单计划时间被丢弃，改派对计划员是死路）**  
**整改后：A-（3 个 P1 + 6 个 P2 已修，详见第 6 节）**

| 维度 | 评价 | 说明 |
|---|---|---|
| 数据正确性 | **差** | 已完成/已取消任务计入热力图与冲突（历史占用冒充未来负荷）；工单 `planned_end` 被 SQL 丢弃 |
| 冲突算法 | 中 | 同工位重叠按"相邻两条"各出一行，123 个任务同日开工 → **115 行重复冲突** |
| 权限一致性 | **差** | 计划员（主用户）看到拖拽把手，点保存必 403（工序改派要 `process:write`，工单改派要车间主任/管理员） |
| 口径自洽 | 差 | 顶部"窗口工时"是任务总工时（含已排除项），与利用率/热力图口径不同 |
| 状态判定 | 差 | `hasOverload` 只看 Top3 峰值，冲突表有超载时仍可能显示"未超载" |
| 默认可视 | 中 | 默认窗口硬编码 `2026-06-01`，无项目筛选（API 支持但页面没暴露） |
| 性能 | 好 | 122 条任务 + 9 工位 12~24ms |
| 测试 | 中 | 后端 6 条 golden/阶段测试，但都锁的是"旧行为"；前端 workload domain 有测试 |

---

## 1. 模块结构

### 1.1 前端

| 文件 | 作用 | 行数 |
|---|---|---|
| `frontend/src/views/MultiSchedule.vue` | 页面：窗口选择、Top3 瓶颈、工位×日热力图、利用率 TOP10、项目占用、冲突表、格子弹窗（拖拽改派） | 452 |
| `frontend/src/domain/workload.ts` | 热力等级/文案、单元格取任务、改派请求构造（纯函数） | ~160 |
| `frontend/tests/domain/workload.test.ts` | 上述纯函数测试 | — |

### 1.2 后端

`GET /api/resources/gantt?start_date=&days=&instance_id=&include_completed=`

| 文件 | 作用 |
|---|---|
| `services/equipment/gantt/resourcesGantt/gantt.js` | 编排 + 组装响应（summary/heatmap/breakdown/utilization/bottlenecks/items/conflicts） |
| `_queries.js` | 取工单/工序源行（可选 instance_id 过滤） |
| `_items.js` | 归一化（起止时间/工时/工位归属）+ 工位日产能推导 |
| `_heatmap.js` | 工位×日热力图（按日历重叠把工时摊到每天） |
| `_conflicts.js` | 冲突检测（同工位重叠 + 单日产能超载） |
| `_breakdown.js` | 项目占用 + 工位利用率排行 + Top3 瓶颈 |
| `_window.js` / `_time.js` | 窗口解析 / 时间工具 |

改派接口：
- 工序：`PUT /api/process_nodes/:id/assign`（`required_workstation_id`）→ 需要 `process:write`
- 工单：`PUT /api/work_orders/:id/workstation` → `onlyForemanOrAdmin`

---

## 2. 发现清单

| 编号 | 级别 | 问题 | 影响 |
|---|---|---|---|
| F-01 | **P1** | 改派权限与页面不匹配：页面无权限门槛，计划员能看到拖拽把手，保存必 403 | 主用户"看起来能改、实际改不了"，无任何提示 |
| F-02 | **P1** | 已完成/已取消任务计入热力图与冲突 | 2026-06 窗口 5 条任务里 4 条已完成，6 条"冲突"全是历史噪声 |
| F-03 | **P1** | 工单计划时间被丢弃：SQL `NULL AS planned_end` + 过滤只认 `planned_start/actual_start`；归一化 actual 优先 | 只有 `planned_end` 的工单完全不显示；有计划的工单被按实际时间摆放，计划负荷错位 |
| F-04 | P2 | `hasOverload` 只看 Top3 峰值 | 冲突表有产能超载时，卡片仍可能显示"未超载" |
| F-05 | P2 | 默认窗口硬编码 `2026-06-01` | 打开页面看到的是过期数据；用户要手动改日期 |
| F-06 | P2 | 页面无项目/历史筛选 | 后端支持 `instance_id`、`include_completed`，页面没暴露；多项目时噪音大 |
| F-07 | P2 | 冲突按相邻两条各出一行 | 2026-11 窗口 122 条冲突（115 条同工位），几乎无法阅读 |
| F-08 | P2 | "窗口工时"口径混乱 | `summary.total_hours` 是任务总工时，与热力图/利用率的窗口占用不一致 |
| F-09 | P2 | 改派无二次确认；循环 PUT 部分失败不回滚、不提示 | 多任务改派中途失败时状态半新半旧，用户不知道哪些成功 |
| F-10 | P3 | 冲突不可定位、热力图无图例、无导出、周末/节假日按 7 天满产能 | 体验与口径细节 |

---

## 3. 逐项详述

### F-01【P1】改派权限错配（计划员必 403）

实测（生产）：

```
PUT /api/process_nodes/999/assign       planner → 403 「权限不足, 需要: process:write」
PUT /api/process_nodes/999/assign       foreman → 400（通过权限，仅 body 空）
PUT /api/work_orders/999/workstation    planner → 400 内含 `{"code":403,"message":"需要车间主绡或审是员权限"}`
PUT /api/work_orders/999/workstation    foreman → 404（通过权限，仅工单不存在）
```

角色权限：`planner` 有 `work_order:write`、`equipment:write`，但**没有 `process:write`**；工单改派又只放行 foreman/admin。而页面菜单/路由没有任何 `requires`，计划员能打开页面、能看到拖拽把手、能打开格子弹窗 → 保存时报 403，且失败信息是一串 mojibake（「车间主绡或审是员」）。

**整改**：前端按权限门控（`process:write` / `work_order:write` 或 foreman/admin），无权限时隐藏拖拽把手、禁用保存并显示原因；保存失败改为逐条收集错误原因。

### F-02【P1】历史任务冒充未来负荷

`normalizeItem` 不过滤状态，`collectItems` 只按窗口重叠过滤。2026-06 窗口实测：

```
total_items=5 | 状态 {completed:4, in_progress:1} | conflicts {capacity_overload:6}
```

4 条已完成任务仍在贡献"冲突"，而资源平衡的使用场景是**未来排程**。

**整改**：默认排除 `completed/cancelled`，响应返回 `summary.excluded_completed_count`，页面提示"已自动排除 N 条历史任务"，右上「含历史」开关（`?include_completed=1`）可复盘。

### F-03【P1】工单计划时间被丢弃

```sql
-- 修改前
SELECT ..., wo.planned_start, NULL AS planned_end, ...
WHERE (wo.planned_start IS NOT NULL OR wo.actual_start IS NOT NULL)
```

- `planned_end` 恒为 NULL → 工单时长只能用 `estimated_hours` 造；
- 只有 `planned_end`、没有 `planned_start/actual_start` 的工单被整条过滤掉；
- 归一化写的是 `start = actual_start || planned_start` → **实际优先**，计划负荷被实际时间覆盖。

生产 4 张工单：`planned_start` 全为空，2 张只有 `planned_end`（06-11 / 06-17），2 张有 `actual_start/actual_end`。于是：
- WO 计划在 06-11，实际 06-22 才开工 → 页面把它画在 06-22，**6 月上旬的计划负荷完全看不见**；
- WO-7 只有 `actual_end` → 修改前彻底不显示。

**整改**：
- SQL 取真实 `planned_end`，过滤条件补 `planned_end/actual_end`；
- 归一化顺序改为**计划优先**（`planned_start || actual_start`），只有结束时间时用「结束 − 工时」回推开始；
- 条目新增 `start_basis / end_basis / hours_basis`（planned/actual/derived、estimated/calendar），页面 tooltip 可解释。

### F-04【P2】"未超载"误报

`hasOverload = top3.some(peak >= 100)`。若第 4 个工位超载，卡片仍显示"未超载"，但下方冲突表有 `capacity_overload` —— 自相矛盾。

**整改**：改为以冲突表 `capacity_overload` 或任一热力格 `>=100%` 为准；顶部再拆「超载 N · 重叠 M」。

### F-05【P2】默认窗口硬编码

```ts
const DATA_START_HINT = '2026-06-01'
const startDate = ref(DATA_START_HINT || monthStart)
```

**整改**：默认当前月；窗口/天数/项目/含历史写入 `localStorage['factory-mes:multi-schedule:window']`，刷新保持。

### F-06【P2】筛选没暴露

后端早已支持 `instance_id`（还支持 `compare`），页面只有日期与天数。

**整改**：新增项目下拉 + 「含历史」开关，切换即重载并记忆。

### F-07【P2】冲突爆炸

修改前按"同工位排序后相邻两条"生成冲突。2026-11 窗口（用户批量重排后 123 个节点都落在 11-10）实测 **122 条冲突**：

```
{ capacity_overload: 7, same_workstation: 115 }
装配工位 A 峰值利用率 1725%（138h / 8h）
```

**整改**：按「工位 × 重叠簇」聚合（区间扫描成簇），一个簇一行，带 `item_count / instance_codes / peak_concurrency / overlap_hours` 和最多 5 条样本。同一窗口 **122 → 14 条**（7 产能超载 + 7 同工位簇）。前端加类型筛选、最多展示 100 行。

### F-08【P2】汇总口径

`summary.total_hours` = 任务工时合计（窗口内任务全量），而热力图/利用率是按日摊分后的窗口占用。

**整改**：新增 `summary.window_busy_hours`（= 热力图合计，单测 GANTT.10 锁定），卡片改为「窗口占用工时」主指标、「任务工时」副指标。

### F-09【P2】改派无确认/部分失败

`saveReassign` 顺序 PUT，一旦某条 403/500，前面的已经写库、后面没执行，只抛一个笼统错误。

**整改**：保存前二次确认（列出目标工位与条数 + 提示"改派不改期，注意目标工位是否超载"）；逐条 try/catch 汇总成功/失败数，失败给原因；只对成功的刷新页面。

### F-10【P3】体验细节

- 冲突行不可点击定位到工序/工单；
- 热力图颜色无图例（只有 hover 文案）；
- 无 CSV 导出；
- 产能模型按自然日 7 天计满（周末/节假日未扣减），与"工作日"口径不一致。

---

## 4. 做得好的地方

1. 后端按阶段拆分（queries/items/heatmap/conflicts/breakdown/window），每个阶段可独立测试；
2. 产能口径修正过（`capacity_per_day` 件/天不再当工时，改按班次 × 人数，封顶 24h）并有测试锁定；
3. 热力图支持"格子 → 拖拽改派"，把"看到瓶颈"和"处理瓶颈"串在一个界面；
4. 窗口解析有钳制（7~180 天），不会一次拉爆；
5. 性能好：122 条任务 + 9 工位 12~24ms；
6. 前端有 workload 纯函数测试（热力等级、单元格取任务、改派请求）。

---

## 5. 修复建议（按优先级）

| 优先级 | 项 | 动作 | 状态 |
|---|---|---|---|
| P1 | F-01 | 前端权限门控 + 失败原因明细 | ✅ 已修 |
| P1 | F-02 | 默认排除已完成/取消 + `include_completed` 开关 | ✅ 已修 |
| P1 | F-03 | 工单取真实 `planned_end`；计划优先；结束回推开始 | ✅ 已修 |
| P2 | F-04 | 超载判定改为冲突/热力为准 | ✅ 已修 |
| P2 | F-05 | 默认当前月 + 窗口记忆 | ✅ 已修 |
| P2 | F-06 | 项目筛选 + 含历史开关 | ✅ 已修 |
| P2 | F-07 | 冲突按簇聚合 + 类型筛选 | ✅ 已修 |
| P2 | F-08 | `window_busy_hours` + 卡片口径 | ✅ 已修 |
| P2 | F-09 | 改派二次确认 + 逐条结果 | ✅ 已修 |
| P3 | F-10 | 冲突定位、图例、导出、工作日日历 | 待排期 |

---

## 6. 整改记录（2026-11-05 当天完成）

### 后端

- `_queries.js`：取真实 `wo.planned_end`；工单/工序过滤条件放宽到四种时间字段任一非空；
- `_items.js`：计划优先归一化、结束回推开始、`start_basis/end_basis/hours_basis`；新增 `collectItemsDetailed`（返回排除条数）；`includeCompleted` 选项；
- `_conflicts.js`：同工位重叠按簇聚合（区间扫描），输出 `item_count/instance_codes/peak_concurrency/overlap_hours/items`；产能超载仍按工位×日；排序按「超载 → 跨项目 → 同工位 → 重叠小时」；
- `gantt.js`：`include_completed` 解析、`summary.window_busy_hours`、`summary.excluded_completed_count`、`filter.include_completed`。

### 前端 `MultiSchedule.vue`

- 头部：项目下拉、日期/天数、**含历史**开关、刷新；窗口与筛选项记忆到 localStorage；
- 汇总卡：窗口占用工时（主）/ 任务工时（副）/ 冲突拆分（超载 + 重叠）；历史排除提示条；
- 冲突表：类型筛选、聚合信息列（涉及项目、任务数、峰值并发）、最多 100 行提示、重叠小时可排序；
- 改派：无权限时隐藏拖拽把手、禁用保存并提示；保存前确认（目标工位 + 条数 + "改派不改期"提示）；逐条成功/失败汇总；
- `hasOverload` 改为以冲突表/热力格为准。

### 验证数据（生产实测）

| 场景 | 修改前 | 修改后 |
|---|---|---|
| 2026-11 窗口冲突（123 节点同日落 11-10） | **122 条**（115 同工位 + 7 超载） | **14 条**（7 超载 + 7 同工位簇），带峰值并发 |
| 2026-06 窗口默认 | 5 条任务（4 已完成）+ 6 条历史冲突 | 1 条任务 + 2 条冲突，并提示"已排除 2 条历史" |
| `include_completed=1` | 不支持 | 3 条任务 / 6 条冲突（复盘视角） |
| 只有 `planned_end` 的工单 | 完全不可见 | 出现，开始时间 = 结束 − 工时（单测 GANTT.8） |
| 工单计划负荷 | 按实际时间摆放 | 按计划时间摆放，`start_basis=planned` |
| 汇总口径 | 只有任务总工时 | `window_busy_hours = 热力图合计`（单测 GANTT.10） |

### 测试与闸门

| 项目 | 结果 |
|---|---|
| `tests/resourcesGanttSplit.test.js` | **10/10**（原 6 条 + 新增 GANTT.7 排除历史 / GANTT.8 结束回推 / GANTT.9 冲突聚合 / GANTT.10 口径） |
| golden fixture | 因响应新增字段而重生成（GANTT.2 覆盖性断言保留） |
| 前端 domain | 119/119 |
| eslint / vue-tsc / build | 0 / 0 / ok |
| 全量部署闸门 | **709/0** |
| 生产产物 | `MultiSchedule-3WSPLVSG.js`（含「含历史」「峰值并发」） |
