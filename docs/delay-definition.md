# 延误口径（2026-11-02 起）

> 背景：2026-11-02 审计发现「延误 128 条全部 critical、KPI 永久高风险」，根因是把"未开工但计划日期已过"和"已开工超期"混成一个指标。
> 结论：按业务确认，延误拆两档，风险 KPI 只统计执行风险。

## 1. 两档定义

| 档位 | 判定条件 | 业务含义 | 进不进风险 KPI |
|---|---|---|---|
| **已开工超期**（started） | `planned_end < now` 且 `status IN ('in_progress','paused')` | 已经开工，但过了计划完成时间 —— 真的拖了 | ✅ 计入 |
| **未开工计划过期**（not_started） | `planned_end < now` 且 `status IN ('pending','ready')` | 还没开工，计划时间已过 —— 排程待重排/确认取消 | ❌ 不计入，单列 backlog |
| **受阻超期**（blocked，工序特有） | `planned_end < now` 且 `status = 'blocked'` | 受阻且已超期，需先解阻 | ✅ 计入（当前系统无此类数据） |

终态（`completed` / `cancelled`）不计入任何档位。

## 2. 字段（向后兼容）

`GET /api/dashboard/risk-summary`：

```json
{
  "total": 12,                       // 执行风险合计 = started + 长交期 + ECO + 服务工单
  "level": { "type": "warning", "label": "需关注" },
  "delays": {
    "work_order_delays": 1,          // 兼容：合计
    "process_node_delays": 127,      // 兼容：合计
    "total": 128,                    // 兼容：合计 = started + not_started + blocked
    "started":     { "work_orders": 1, "process_nodes": 4, "total": 5 },
    "not_started": { "work_orders": 0, "process_nodes": 123, "total": 123 },
    "blocked":     { "process_nodes": 0 }
  },
  "backlog": { "not_started": 123, "hint": "计划时间已过但尚未开工，需重排程或确认取消" },
  "sources": {
    "delays": 128,
    "delays_started": 5,
    "delays_not_started": 123,
    "delays_blocked": 0,
    "long_leadtime": 6,
    "long_leadtime_urgent": 3,       // ≥16 周（长交期分两档）
    "open_eco": 1,
    "open_field_service": 0
  },
  "items": [
    { "key": "delays_started", "label": "执行中超期", ... },
    { "key": "delays_not_started", "label": "未开工计划过期", ... },
    { "key": "long_leadtime", "label": "长交期关键件", "hint": "≥12 周（其中 ≥16 周紧急 3 项）" },
    { "key": "open_eco", ... },
    { "key": "open_field_service", ... }
  ]
}
```

`GET /api/dashboard/delays`：每条明细多一个 `phase`（`started` / `not_started` / `blocked`），并返回 `by_phase`；支持 `?phase=started` 过滤（`total` 始终是全部延误，不随过滤变）。

`GET /api/dashboard/delays/summary`：新增 `started` / `not_started` / `blocked` 三个标量 + `by_phase` 明细。

## 3. 风险等级

```
total = started + long_leadtime + open_eco + open_field_service
total >= 10 → 高风险；>= 4 → 需关注；否则 → 平稳
```

即"未开工计划过期"不再把等级推红：当前 5 执行中超期 + 6 长交期 + 1 ECO = **12 → 高风险**（如果只算旧的 128 + 8 = 136 也是高风险，但数值已不可比）。

## 4. 前端展示

- KPI「风险待办」：大数字 = 执行风险合计；副标题两行：`5 执行中超期 · 123 未开工过期` / `1 ECO · 0 服务`
- 「交付风险雷达」：5 条风险项（执行中超期 / 未开工计划过期 / 长交期 / ECO / 服务工单）
- 「延误预警」条：标题显示 `执行中超期 5 / 未开工过期 123`；明细表新增「阶段」列（执行中 / 未开工 / 受阻）
- 「长交期关键件」表：≥16 周的行标「紧急」

## 5. 代码位置

| 位置 | 内容 |
|---|---|
| `services/reportService/schema.js` | `v_risk_counts`（两档计数 + 长交期两档）、`v_dashboard_counts`、`v_instance_type_counts`、`v_long_leadtime_components`（`is_urgent`） |
| `services/reportService/dashboard.js` | `buildRiskSummary()` 组装 total / delays / backlog / sources / items |
| `services/delayAlerts.js` | 明细 `phase` 分档 + `by_phase` + `?phase=` 过滤 |
| `frontend/src/views/Dashboard.vue` | `executionDelays` / `planOverdue` 计算并传 KPI 卡 |
| `frontend/src/views/dashboard/DashboardKpiGrid.vue` | 风险卡副标题 |
| `frontend/src/views/dashboard/DashboardInstanceRiskTables.vue` | 延误条 + 阶段列 + 紧急标记 |

## 6. 测试

| 文件 | 覆盖 |
|---|---|
| `tests/dashboardRiskSummary.test.js`（3 条） | 两档计数、backlog、风险合计只算执行风险、长交期两档、by_type |
| `tests/delayAlerts.test.js`（4 条） | 排序/严重度、`by_phase`、`?phase=` 过滤、summary 拆分 |
| `tests/readModelViews.test.js`（9 条） | 视图列（含拆分列）与看板透传 |
| `tests/apiPermissionsDashboard.test.js`（3 条） | 8 个仪表盘 GET 接口的 `report:read` 权限矩阵 |

## 7. 已知边界

1. **时区**：比较基准是 UTC（`datetime('now')` / `toISOString()`），而 `planned_end` 存的是本地班次时间 → 最多少算 8 小时。属审计 F-06，待业务确认后统一。
2. **未开工过期仍是 0 天粒度**：超过 7 天才 critical 的分级对"未开工"没意义，前端只用阶段列区分。
3. **风险等级阈值仍硬编码**（10/4），审计 F-13 建议配置化，尚未做。
