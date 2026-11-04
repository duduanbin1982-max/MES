# 排程甘特图（2026-11-04）

> 入口：`项目排程 /schedule → 「甘特图」标签页`  
> 代码：`frontend/src/views/schedule/GanttChart.vue`、`frontend/src/domain/gantt.ts`、`services/schedule/routes/routes_gantt.js`  
> 特点：左侧固定"项目 / 工序"列，右侧时间轴；**拖动条形即可改期（按天吸附）**。

## 1. 页面能力

| 能力 | 说明 |
|---|---|
| 时间轴 | 日 / 周 / 月 三档缩放（日 30px、周 10px、月 4px 每天） |
| 月份导航 | 上一月 / 本月 / 下一月，默认当月 |
| 项目过滤 | 全部项目 / 指定项目 |
| 条形颜色 | 已完成=绿、执行中=橙、超期=红、受阻=深红、待开始=蓝 |
| 今日标线 | 红色竖线 + 「今天」标签（区间内才显示） |
| 周末底纹 | 周六/周日浅灰，月首有分隔线 |
| 拖拽改期 | 按住条形左右拖动，松开按整天吸附并保存；拖动时实时预览位移 |
| 双击行 | 打开「分配 / 调整工序」弹窗（改负责人、工位、时间） |
| 未排程提示 | 顶部黄色 alert：还有 N 个工序没有计划时间（不会显示在图上）+「批量重排程」入口 |
| 悬停提示 | 条形 tooltip 显示 工序 / 计划时间 / 工位 / 负责人 / 工时 |

## 2. 后端接口

### GET `/api/schedule/gantt`

参数：`from`（YYYY-MM-DD，默认本月 1 号）、`to`（默认本月最后一天）、`instance_id`（可选）、`include_unscheduled`（默认 1）。

返回：

```json
{
  "from": "2026-11-01", "to": "2026-11-30",
  "days": [{ "date": "2026-11-01", "day_of_month": 1, "weekday": 0, "is_weekend": true, "is_month_start": true }],
  "groups": [{ "instance_id": 1, "instance_code": "TBM-2026-001", "instance_name": "…", "nodes": [
    { "id": 135, "operation_name": "下料", "status": "ready", "phase_code": null,
      "planned_start": "2026-11-10", "planned_end": "2026-11-10 04:00:00",
      "estimated_hours": 1, "assigned_name": null, "workstation_name": "装配工位 A" }
  ]}],
  "unscheduled": [{ "id": 940, "operation_name": "涂装", "status": "ready", "instance_code": "…" }],
  "total_nodes": 122, "truncated": false
}
```

规则：
- 取**计划时间与区间重叠**的节点（`date(planned_start) <= to AND date(planned_end) >= from`）；
- 未排程 = `planned_start` 与 `planned_end` 都为空且未完成/未取消（最多 500 条）；
- 区间上限 370 天，节点上限 3000（超出 `truncated=true`）；
- 非法区间（to < from）返回 400。

### PUT `/api/schedule/process-nodes/:id/dates`

拖拽保存用。body：`{ "planned_start": "2026-11-11", "planned_end": "2026-11-19 08:00:00" }`（至少给一个）。

校验：
- 格式 `YYYY-MM-DD[ HH:mm[:ss]]`；
- `planned_end` 不能早于 `planned_start`；
- **已完成节点不可改计划时间**（400）；
- 节点不存在 404。

## 3. 前端几何计算（`domain/gantt.ts`）

| 函数 | 作用 |
|---|---|
| `buildScale(from, to, zoom)` | 生成每天一格的时间轴（含周末/月首标记、总宽度） |
| `barGeometry(node, scale)` | 计算条形 `left/width`（跨区间边界自动裁剪，单天至少 0.6 天宽） |
| `shiftDates(node, deltaDays)` | 拖拽 N 天后的新计划时间，**保留原时分秒格式** |
| `todayOffset(scale, today)` | 今天在时间轴中的像素位置（区间外返回 null） |
| `monthSegments(scale)` / `tickLabel(day, zoom, index)` | 表头月份跨列与刻度 |
| `monthRange(anchor)` | 某月的起止日期 |

## 4. 拖拽实现

- 条形 `pointerdown` → 记录起点 X，`pointermove` 计算 `deltaDays = round(位移 / dayWidth)`，条形实时位移预览（不改数据）；
- `pointerup`：`deltaDays !== 0` 时 emit `move`，页面调用 PUT 保存；
- 保存成功 → 提示"已改期 +N 天"并刷新甘特图与周视图；失败 → 提示错误并重新拉取（回滚视觉位移）；
- 桌面/触屏统一用 Pointer Events。

## 5. 实测

- 甘特数据（生产）：2026-11 区间 **122 个节点 / 1 个项目 / 39 个未排程 / 30 天**；7–12 月宽区间 **184 天 / 130 节点 / 2 个项目**。
- 拖拽保存：节点 #296 计划时间 `2027-01-11 ~ 2027-01-19` → PUT 改成 `2026-11-11 ~ 2026-11-19 08:00:00` → 库中已更新 → 还原后逐字节一致。
- 单测：后端 `tests/scheduleGantt.test.js` **5/5**；前端 `tests/domain/gantt.test.ts` **8/8**；`scheduleSplit` 5/5（路由清单 12 条）。



## 7. 依赖箭头（2026-11-04 追加）

数据来自 `process_dependencies(predecessor_id, successor_id, dep_type, lag_hours)`（当前生产 89 条）。

- **接口**：`GET /api/schedule/gantt` 响应新增 `dependencies` 与 `total_dependencies`；
  只返回**两端都在本次区间结果里**的依赖（前驱在区间内、后继也在区间内）。
- **画法**：前驱条形右端 → 后继条形左端，贝塞尔曲线（控制点 12~60px，正向/回绕都成立）；
  箭头用 SVG `marker-end` 自动定向。
- **颜色**：两端任一为「超期 / 受阻」→ 红色告警；否则灰蓝常规线。
- **交互**：
  - 工具栏「依赖箭头」开关可整层关闭；
  - 鼠标悬停某条形时，与它相连的依赖线高亮为蓝色加粗（快速看上下游）。
- **实现**：`GanttChart.vue` 在渲染后读取每个条形 `data-node-id` 的 `getBoundingClientRect`，
  相对容器换算成 SVG 坐标；`watch(groups/from/to/zoom/showDependencies)` + `ResizeObserver` 自动重算。
  与滚动无关（SVG 和条形在同一个滚动内容里）。
- **单测**：`GT.9 dependencyPath`（正向/回绕/控制点上下限）、`GT.10 dependencyTone`、`GT.11 arrowEndpoints`。
- **后端单测**：`SG.1` 断言依赖只保留两端在窗口内的（2→3 的未排程、2→4 的跨月都会被正确排除）。

已知边界：`dep_type` 目前只有 `FS`（完成-开始）语义，尚未对 `lag_hours` 做可视化偏移（只作为提示字段保留）。


## 8. 选中节点依赖过滤（2026-11-04 追加）

依赖多的时候（生产 82 条）线会交叉，所以做了"只看选中节点"：

- **单击条形** → 选中该工序，顶部出现选择条：
  `已选：<工序名>  上游 N  下游 M  [清除选中]`
- 选中态下：
  - **上游依赖**（选中节点是后继）→ 蓝色加粗线 + 上游工序行浅蓝底；
  - **下游依赖**（选中节点是前驱）→ 绿色加粗线 + 下游工序行浅绿底；
  - **其余依赖线淡出到 7% 透明度**，无关工序行透明度降到 45%；
- **再次单击同一条形** / 点图表空白处 / 按 **Esc** / 点「清除选中」→ 取消选中，恢复全量；
- 数据刷新后若选中节点已不在当前区间，自动清除选中；
- 拖拽改期后会抑制紧随的 click，避免"拖完顺手选中"。

实现：`domain/gantt.ts` 的 `dependencyRelation` / `neighborIds`（**只取一跳**：直接前驱/直接后继）/ `nodeRelation`；
`GanttChart.vue` 用 `rowClass()`、`arrowClass()`、`arrowMarker()` 三个函数映射样式，箭头 marker 按上/下游用不同颜色。
单测：`GT.12 dependencyRelation`、`GT.13 neighborIds`、`GT.14 nodeRelation`（共 14 条甘特单测）。

## 9. 已知边界

1. **不画依赖箭头**：`process_nodes` 的先后关系暂未在图上连线（可后续加 `process_node_dependencies`）。
2. **不做跨项目资源冲突提示**：同工位撞期不会高亮（需要按工位聚合计工时）。
3. **拖拽只改计划时间**：不改状态、不改派工；需要改状态用行内按钮或行双击弹窗。
4. **未排程节点不上图**：通过顶部提示 + 批量重排程处理。
5. 一次最多渲染 3000 条；超过会截断（提示 truncated）。
