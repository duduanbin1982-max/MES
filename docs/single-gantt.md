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

## 5. 已知边界（P2/P3，未在本次整改范围）

1. 未排程条仍用依赖推算位置（已加虚线边框 + tooltip 说明）；
2. fallback 推算只按 FS，不读 SS/FF/SF 与 lag（scheduler 主算法支持）；
3. 实际时间（`actual_start/actual_end`）尚未叠加为"计划 vs 实际"；
4. 告警区仍是全局告警（`/dashboard/alerts`）；
5. 无缩放档位（固定 8px/天）、无多选批量改期。
