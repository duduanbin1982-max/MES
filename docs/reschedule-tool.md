# 批量重排程工具（2026-11-03）

> 用途：把「未开工但计划时间已过」的工序节点批量顺延，修复排程过期（仪表盘审计 F-08）。  
> 入口：`项目排程 /schedule → 右上角「批量重排程」`  
> 代码：`services/schedule/reschedule.js`、`frontend/src/views/Schedule.vue`

## 1. 它改什么、不改什么

| 改 | 不改 |
|---|---|
| `process_nodes.planned_start` | 状态（pending/ready 保持原样） |
| `process_nodes.planned_end` | 实际开始/结束时间（actual_start/actual_end） |
| `updated_at` | 派工关系、工时、BOM、成本 |

**默认只处理** `status IN ('pending','ready')` 且 `planned_end < now` 的节点；已开工（in_progress/paused）、已完成、已取消的节点一律不动。

## 2. 两种重排方式

| 方式 | 说明 | 例子 |
|---|---|---|
| **对齐到日期** | 把该范围**最早**的工序计划开始时间对齐到目标日期，其余节点按原相对间隔整体平移 | 最早 2026-07-01，目标 2026-11-10 → 顺延 132 天 |
| **顺延天数** | 全部候选节点统一 +N 天（1~365） | 顺延 90 天 |

> 时间格式保留原样：`2026-07-01` 仍是日期；`2026-07-01 04:00:00` 顺延后仍是带时分秒的格式（不会把 `04:00:00` 变成 `04:00`）。

## 3. 操作流程（界面）

1. `/schedule` → 「批量重排程」
2. 选项目范围（默认全部项目）、勾选「只处理未开工且计划已过期」
3. 选「对齐到日期」（推荐）或「顺延天数」，填备注
4. 点 **预览** → 显示将调整的节点数、涉及项目数、实际顺延天数，以及明细表（旧 → 新）
5. 点 **应用（N 条）** → 二次确认 → 服务端在事务内更新并写批次日志

## 4. 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/schedule/reschedule/preview?instance_id=&shift_days=&anchor_date=&only_overdue=&statuses=` | 只读预览（返回 stats + 前 300 条明细） |
| POST | `/api/schedule/reschedule/apply` | 应用；body 同上 + `node_ids?`（白名单）+ `note?` |
| GET | `/api/schedule/reschedule/batches?limit=20` | 批次历史 |
| POST | `/api/schedule/reschedule/batches/:id/undo` | 撤销整批 |

返回示例（apply）：

```json
{ "ok": true, "batch_id": 1, "batch_no": "RS-20261102-001",
  "node_count": 123, "shift_days": 132,
  "stats": { "total": 123, "instance_count": 2, "by_instance": [...] } }
```

## 5. 安全设计

1. **服务端重算候选**：apply 不信任前端传来的节点列表，按同样的筛选条件在服务端重新取；
   `node_ids` 只能做"缩小范围"的白名单，不能扩大。
2. **默认排除在制节点**：`statuses` 只允许 `pending/ready/blocked`，传 `in_progress/completed` 直接 400。
3. **批次日志**：每次应用写 `process_reschedule_batches`（批次号、天数、范围、每节点新旧时间快照、操作人、备注）。
4. **可撤销**：撤销只还原"当前时间仍等于本批次写入值"的节点；若节点之后被手工改过则跳过（`skipped` 计数），不会覆盖人工调整。
5. **参数校验**：天数 1~365；`anchor_date` 必须 `YYYY-MM-DD`；无候选节点返回 400。

## 6. 实测记录

- 预览（生产，2026-11-02）：**123 个候选节点**（TBM-2026-001：122 个，TBM-2026-003：1 个），
  对齐到 2026-11-10 → 实际顺延 132 天（最早 2026-07-01）。
- 自测（项目 #6，1 个节点）：应用 → 计划时间 `2026-09-01 → 2026-11-10`（顺延 70 天，时分秒保留）→ 撤销 → **逐字节还原**。
- 单测：`tests/reschedule.test.js` **9/9**（时间平移、候选筛选、anchor 模式、白名单、批次日志、撤销、参数校验）。

## 7. 已知边界

1. **不动依赖关系**：只平移时间，不重排工序先后（平移保持相对顺序，所以顺序不变）。
2. **不检查工时冲突**：顺延后可能与其它项目的工位/人力撞期，需排程员看甘特图确认。
3. **时区**：`planned_end < datetime('now')` 用 UTC 比较（仪表盘审计 F-06），最多少算 8 小时。
4. **撤销是整批级**，不支持"撤销其中几条"；如需精细调整，撤销后用甘特图单条改。
5. 只处理 `process_nodes`，不动 `work_orders` 的计划时间（工单计划另有一套，暂未纳入）。
