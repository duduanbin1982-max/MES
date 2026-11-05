# 单项目甘特（/gantt）

> 页面：`项目与装备 → 单项目甘特`（`/gantt`）  
> 代码：`frontend/src/views/Gantt.vue`（页面）、`frontend/src/domain/singleGantt.ts`（时间轴纯函数）、`services/equipment/gantt/instanceGantt/*`（读取）、`services/equipment/scheduler/*`（重新排程）  
> 2026-11-05 按审计 F-01/F-02/F-03 整改。

## 1. 页面能力

| 区域 | 内容 |
|---|---|
| 顶部 | 项目选择、刷新、**重新排程**（先预览再应用） |
| 4 张统计卡 | 项目 / 计划跨度（天·周）/ 工序工时（已排·未排）/ 告警数 |
| 甘特主图 | 按子系统分组；条形按状态着色；**月份列宽 = 该月真实天数 × 8px**；周刻度线；**今天标线** |
| 条形 | 计划时间来自 `process_nodes.planned_start/planned_end`；未排程节点用虚线边框 + "未排程"标签（按依赖推算的只读位置） |
| 告警表 | 全局告警（长运行工单 / 卡住节点 / 长交期 / ECO） |

## 2. 时间轴（F-02 修复）

原实现：月份列固定 240px（30 天 × 8px），条形按真实天数 × 8px 定位 → 到 11 月错位 24px、表头比条形内容多 368px。

现在：`buildTimeline(projectStart, projectEnd, dayWidth)` 按月切列，但**每列宽度 = 该月落在区间内的真实天数 × dayWidth**：

| 区间 | 月份列宽 |
|---|---|
| 2026-07-01 ~ 09-30 | 31×8 / 31×8 / 30×8 px |
| 2026-07-15 ~ 08-10 | 17×8 / 10×8 px（首尾裁剪） |
| 2026-12-20 ~ 2027-03-05 | 12 / 31 / 28 / 5 天 |

于是 `2026-08-01` 的条形左边界 **正好等于** 8 月列左边界（单测 SG.5 回归）。
另加：周刻度线（每 7 天）、今天红竖线、条形最短 8px、宽度 ≥ 56px 才在条内显示文字。

## 3. 重新排程（F-01 注册 + F-03 预览/保护/撤销）

### 3.1 接口

```
POST /api/equipment_instances/:id/schedule?dryRun=1&start=YYYY-MM-DD   # 预览（不写库）
POST /api/equipment_instances/:id/schedule[?start=YYYY-MM-DD]          # 应用（写库 + 记批次）
GET  /api/equipment_instances/:id/schedule                             # 同应用（调试）
```

响应关键字段：

| 字段 | 说明 |
|---|---|
| `node_count` / `schedulable_count` / `protected_count` | 总节点 / 可排 / 受保护（已完成或已取消） |
| `protected_nodes` | 受保护节点清单（这些节点的计划时间不会被改） |
| `changed_count` / `unchanged_count` | 将变更 / 不变的节点数 |
| `full`（仅 dryRun） | 全量明细：`previous_planned_start/end` → `planned_start/end`，`changed` 标记 |
| `batch_no` / `batch_id`（仅应用） | 本次写入的批次号（`SC-YYYYMMDD-NNN`）与批次 id，用于撤销 |
| `errors` | 存在无法排程的节点时**阻止写入**并返回原因 |

### 3.2 行为变更（F-03）

1. **跳过已完成/已取消节点**：不再重写历史计划；它们的计划/实际时间作为后继的约束锚点；
2. **只写有变化的节点**：新旧计划完全相同的节点不写库、不计入 `written_count`；
3. **写库前先预览**：页面点击「重新排程」先调 `dryRun=1`，展示"将变更 N 条、受保护 M 条、错误 K 条"和旧→新明细，确认后才提交；
4. **可撤销**：应用时写入 `process_reschedule_batches`（批次号 `SC-…`，`items_json` 保存每节点新旧时间），页面顶部出现「撤销本次排程」，调用既有
   `POST /api/schedule/reschedule/batches/:id/undo` 还原（若节点之后被手工改过则跳过）。

### 3.3 算法

拓扑排序（Kahn）+ 环检测；支持 FS/SS/FF/SF 依赖与 `lag_hours`；同工位串行；`?start=` 可覆盖项目开始日；
有环时返回 400 + `cyclic_node_ids`。

## 4. 验证（2026-11-05）

| 项目 | 结果 |
|---|---|
| 路由存活 | `POST /api/equipment_instances/1/schedule?dryRun=1` → **200**（修复前 404） |
| 预览（生产项目 1） | 156 节点 / 可排 153 / **受保护 3**（总装、采购下单、焊接） / 将变更 150 / 不变 3 / written 0 |
| 空项目应用 | `POST /api/equipment_instances/8/schedule` → 200「no nodes」，不写库 |
| 后端单测 | `tests/scheduler.test.js` **7/7**（含：已完成节点不被重排、dryRun 明细、写库记批次、batch_id、模块装配守卫） |
| 前端单测 | `frontend/tests/domain/singleGantt.test.ts` **8/8**（月份真实天数、首尾裁剪、跨年 2 月、条形对齐回归、今天线） |
| 闸门 | **696/0**；前端 domain 118/118 |


## 6. 实际进度（F-06）

- 后端 `bars[].progress` + `progress_basis`：
  - `completed` → 100（basis=status）
  - `in_progress` / `paused`：有 `actual_start` 时按 **已开工时长 ÷ 计划跨度** 估算，夹在 5%~95%（basis=actual_elapsed）；没有实际开工时间则给 50%（basis=status）
  - 其它 → 0
- 项目级 `progress_pct`：按工时加权（Σ 工时×进度 ÷ Σ 工时），页面图例右侧用进度条展示；
- 条形：计划色为底色，**实际进度用左侧深色覆盖层**（宽度 = progress%），已完成节点整条变深；
- **实际开始标记**：`actual_start` 在计划跨度内的相对位置画一条红色竖线（悬停显示"实际开始"）；
- tooltip 增加：进度%（含依据）、实际起止时间；
- 生产实测：TBM-2026-001 项目进度 **24%**；有实际时间的节点 2 个（数据现状，功能已就绪）。

## 7. 本项目告警（F-07）

新接口：`GET /api/equipment_instances/:id/alerts`（权限 `equipment:read`，与页面一致；不再依赖 `report:read` 的全局 `/dashboard/alerts`）。

| 类型 | 判定 | 分级 |
|---|---|---|
| 工序超期 | `planned_end` 已过且未完成/取消 | >7 天 danger、≥3 天 warning、其余 info |
| 工序受阻 | status=blocked | danger |
| 工序未排程 | planned_start 与 planned_end 都为空 | warning |
| 里程碑延期 | `instance_milestones.planned_end` 已过且未完成 | 同超期分级 |
| 工单长运行 | 工单 in_progress 且实际开工 >30 天 | warning |

响应：`{ instance, count, by_severity:{danger,warning,info}, alerts:[{type,type_label,severity,message,ref}] }`，按危险度排序、最多 200 条。

生产实测：TBM-2026-001 共 **32 条**（danger 4 条工序超期、warning 28 条：27 条未排程 + 1 条里程碑延期），且**只统计本项目**（另一项目告警不会串入）。

## 8. 未排程条视觉区分（F-04）

- 条形加**斜纹覆盖层** + 虚线边框（原只有虚线边框，容易和真实计划混淆）；
- 行标签由「未排程」改为「**未排程·推算**」；
- tooltip 明确「未排程，按依赖推算」及推算依据。

## 9. fallback 支持依赖类型与间隔（F-05）

未排程节点的只读推算（`instanceGantt/_scheduler.js`）现在与正式排程同一套约束：

| 类型 | 约束 |
|---|---|
| FS | 前驱结束 |
| SS | 前驱开始 |
| FF | 前驱结束 − 本节点工时 |
| SF | 前驱开始 − 本节点工时 |

并叠加 `dep.lag_hours`。单测 IGANTT.8 覆盖 5 种情形（FS / FS+lag / SS / FF / SF）。


## 11. 缩放档位（2026-11-05 第二轮）

| 档位 | 每天像素 | 适用 |
|---|---|---|
| 日 | 24px | 近期细排，日格线可见 |
| 周 | 8px（默认） | 看整月排程 |
| 月 | 4px | 看整季/全年 |

- 按钮在甘特卡片右上（`日 / 周 / 月`），切换即时重算时间轴与条形；
- 网格线随档位变化：日视图画**每天**一条，周/月视图画**每 7 天**一条；
- 常量集中在 `frontend/src/domain/singleGantt.ts` 的 `ZOOM_DAY_WIDTH`，单测 SG.9 校验三档宽度与等比缩放（日视图总宽 = 周视图 × 3）。

## 12. 告警点击跳转（2026-11-05 第二轮）

告警行（整行或右侧按钮）可点击，按 `ref` 类型分流：

| 告警类型 | 点击行为 |
|---|---|
| 工序超期 / 工序受阻 / 工序未排程 | **滚动定位到甘特图对应行**并高亮 3 秒（`data-node-id` + `scrollIntoView`） |
| 工单长运行 | 跳转 `/work-orders?instance_id=<本项目>`（按项目过滤工单） |
| 里程碑延期 | 跳转 `/instances/<本项目>` 项目详情 |

按钮文案随类型变化：`定位工序 / 看工单 / 看项目`；无 `ref` 的告警显示 `—` 且不可跳。


## 14. 多选批量改期（2026-11-05 第三轮）

- 交互：甘特行左侧勾选框 / 点条形 → 选中；工具条显示「已选 N 条 · 批量改期 · 清空」；
- 弹窗：输入**整体平移天数**（可负数，±3650 内）→ **先预览**（旧 → 新）→ 确认应用；
- 接口：

```
POST /api/equipment_instances/:id/nodes/date-shift
  body: { "node_ids": [135,136], "shift_days": 2 }
  query: ?dryRun=1 预览
```

| 规则 | 行为 |
|---|---|
| 已完成 / 已取消 | 跳过（不改历史计划） |
| 未排程（计划时间为空） | 跳过（无法改期） |
| 不属于本项目 | 跳过 |
| 重复 id | 自动去重 |
| 单次上限 | 500 条；`shift_days` 非零整数且 ≤ ±3650 |
| 日期格式 | 原值 10 位（纯日期）→ 保持 `YYYY-MM-DD`；带时分秒 → 保持 `YYYY-MM-DD HH:MM:SS` |

- 写入记批次 `MS-YYYYMMDD-NNN`（`items_json` 含 old/new 快照），页面顶部「撤销本次操作」可整批回滚（复用 `/api/schedule/reschedule/batches/:id/undo`）。

**端到端实测（生产）**：节点 135/136 平移 +2 天 → 批次 `MS-20261105-001` → 日期正确 +2 天 → 撤销 `restored: 2, skipped: 0` → 日期完全还原 ✅

## 15. 缩放档位持久化（2026-11-05 第三轮）

- 选择写入 `localStorage['factory-mes:single-gantt:zoom']`，刷新后保持上次档位（默认「周」）；
- 隐私模式/禁用存储时静默忽略，不影响功能。

## 16. 工单告警锚点（2026-11-05 第三轮）

- 告警 `ref` 增加 `wo_code`；点击「工单长运行」→ `/work-orders?instance_id=<项目>&wo=<工单号>`；
- 工单页读取 `?wo=`，命中行高亮（warning 底色）并 `scrollIntoView` 居中；`?wo=` 变化时重新定位。

## 17. 已知边界（剩余）

1. 实际进度对"进行中但无 actual_start"的节点只能给 50%（需现场录入实际开工时间）；
2. 里程碑/工单告警只做超期与长运行，未做资源冲突类告警（跨项目冲突见 `/multi-schedule`）；
3. 单项目甘特暂不支持**拖拽改单条**（批量平移已覆盖多选场景，单条可用批量改期选 1 条）；
4. 项目级告警未做订阅/推送（如需可接 WebSocket 或定时任务）。
