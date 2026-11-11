# 工单现场计时功能实施报告

> 日期：2026-11-11  
> 范围：工单扫码开始/暂停/完成自动计算实际用时  
> 结论：**已完成，不新增“图纸计时”；全量闸门 955/0。**

## 1. 需求与范围

目标：员工扫描工单开始作业后系统计时，完成工件/工单后再次扫码结束，自动得到有效用时。

明确不做的部分：

- 不新增图纸作业计时表；
- 不新增文档签收计时；
- 不覆盖现有报工工时 `actual_hours` / `work_report_details`；
- 只做“工单现场用时”，作为现场效率/进度依据。

## 2. 实现内容

### 2.1 数据

迁移 `033_work_order_timer.sql`，`work_orders` 新增：

```text
actual_duration_seconds   系统计算的有效用时秒数
actual_duration_hours     有效用时小时数
timer_status              running / paused / stale / stopped
```

### 2.2 计时算法

位置：`services/workOrderTimer.js`

从 `work_order_operations` 读取：

```text
start
pause
block
complete
```

算法：

- `start`：开启计时区间；从 paused/blocked 再次 start 视为继续；
- `pause` / `block`：结束当前区间；
- `complete`：结束当前区间并汇总；
- 多个区间累加，排除暂停/卡住时间；
- 服务端时间计算；
- 超过 72 小时未结束标记 `stale`，不把历史几个月时间一次性算入。

### 2.3 扫码 API

`services/scanner.js`：

- 修复工时校验：`start/pause/block/complete` 允许工时为空或 0；
- 负数/超过 24 小时仍拒绝；
- 每次扫码动作后重新计算并写回计时；
- 扫码完成响应返回：

```text
actual_duration_seconds
actual_duration_hours
timer_status
timer_started_at
```

- `scan/lookup` 也会返回当前计时状态；
- paused/blocked 后再次 start 允许继续；
- 原 `actual_hours` 完全不动。

### 2.4 工单 API

`services/workOrderService.js`：

- 工单列表/详情自动刷新计时字段；
- 新增字段随 `wo.*` 返回。

### 2.5 前端

#### `/scan`

工单扫码后新增计时面板：

```text
现场计时
00:00:00
[计时中 / 已暂停 / 超时未结束 / 未计时]
开始：2026-11-11 10:00:00
```

- 每秒刷新；
- 开始/暂停/完成后自动重新查询；
- 完成结果摘要显示“现场用时”。

#### `/work-orders`

工单列表增加：

```text
现场用时（actual_duration_hours）
计时状态（running/paused/stale/stopped）
报工工时（原 actual_hours）
```

工单详情同步显示现场用时、计时状态、报工工时。

## 3. 与工单报工的边界

| 字段 | 来源 | 用途 |
|---|---|---|
| `actual_duration_hours` | 扫码计时 | 现场实际用时、效率、进度 |
| `actual_hours` | `/process-hours` 报工审批 | 人工成本、正式工时 |
| `work_report_details.hours_spent` | 报工单 | 审批、成本入账 |

因此：

- 现场计时不会绕过报工审批；
- 不会出现两套人工成本；
- 报工工时仍按现有流程审批后计入成本。

## 4. 生产数据

当前 4 张工单：

| 工单 | 状态 | 现场用时 | 计时状态 |
|---|---|---:|---|
| TEST-001 | completed | 0 | stopped |
| WO-TBM2026001-S3-001 | completed | 0 | stopped |
| WO-TBM2026001-S3-002 | in_progress | 0 | **stale** |
| WO-TBM2026002-S3-001 | pending | 0 | stopped |

说明：

- `WO-TBM2026001-S3-002` 是 2026-06-22 开始、一直未结束的历史工单；
- 若不处理，墙钟会算 3400+ 小时；
- 已标记 `stale`，不做历史时间一次性灌入；
- 操作员下次扫码暂停/完成时，不会把 141 天全部算入。

## 5. 验证

| 项目 | 结果 |
|---|---|
| 新增 `tests/workOrderTimer.test.js` | **3/3** |
| 暂停/继续只累计有效区间 | 通过 |
| 0/空工时扫码开始允许 | 通过 |
| 负数工时拒绝 | 通过 |
| 超过 72h stale | 通过 |
| 全量部署闸门 | **955/0** ✅ |
| 前端 eslint / typecheck / build | 通过（已部署） |
| `/work-orders` | 出现现场用时/计时/报工工时分列 |
| `/scan` 查询历史工单 | 计时 00:00:00，状态“超时未结束”，无 pageerror |

## 6. 业务口径

按本次实现，**暂停/午休/等料必须由员工点“暂停”**，否则该段时间会算入现场用时。

原因：

- 系统只能识别操作事件，无法自动判断员工是否在休息/等料；
- 若要求自动排除午休，需要班次日历/考勤数据，当前未接入。

建议现场制度：

```text
开始作业 → 开始扫码
午休/等料/下班 → 暂停扫码
继续作业 → 再次扫码开始
完成 → 完成扫码
```

## 7. 仍需注意

1. 现场用时和报工工时是两个口径，不要互相覆盖。
2. 历史 stale 工单需要现场暂停/完成处理，或管理员修正。
3. 当前只做了工单级计时，不是工序节点级计时。
4. 多操作员/多人协同同一工单时，计时是工单级总时长，不按人拆分。
5. 未自动生成报工单；如需要，可把完成扫码后的 `actual_duration_hours` 预填到新报工草稿。
6. 未接考勤/班次日历，不能自动扣除午休。

## 8. 复验

1. `/scan` 扫一个 pending 工单 → 开始；
2. 页面计时每秒增长；
3. 暂停 → 计时停止；再次开始 → 继续累计；
4. 完成 → 计时结束，工单字段 `actual_duration_hours` 有值；
5. `/work-orders` 看到现场用时与计时状态；
6. 历史 stale 工单扫码显示“超时未结束”，暂停后不会灌入 141 天；
7. `node --test tests/workOrderTimer.test.js`。
