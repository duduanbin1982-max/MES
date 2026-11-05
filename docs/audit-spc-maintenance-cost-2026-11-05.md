# SPC / 维护（TPM）/ 成本 三条链路深挖报告

> 审计日期：2026-11-05  
> 审计方式：代码走读 + 生产数据核对 + 真实 API 实测（三条链路各做一次闭环演练/验证）  
> 关联：既有成本三层差异（P2-2）已于 2026-10-19 修复，本次复核未发现新缺陷

## 0. 结论

| 链路 | 评级 | 发现 | 整改 |
|---|---|---|---|
| SPC（参数 → 控制图 → 判异 → 告警） | B+ | 3 个 P2 | 已修 |
| 维护 TPM（计划 → 完成 → 备件 → 停机指标） | **C** | 2 个 P1 + 2 个 P2 | 已修 |
| 成本（成本归集 → ERP 汇总 → 项目成本 → 差异） | A- | 无代码缺陷（2 项数据治理） | 复核通过 |

全量部署闸门 **781/0**。

## 1. SPC 链路

### 1.1 现状

`process_params`（IoT/手工采集 6 类参数）→ `/api/spc/analyze`（Xbar-R + Cpk + WECO 判异）→ `spcMonitor` 定时分析写 `spc_alerts` → `/api/spc/dashboard`。生产数据：`spc_alerts` 96 条（全部未确认）、3 个工序节点有参数数据。

### 1.2 发现与整改

| 编号 | 级别 | 问题 | 整改 |
|---|---|---|---|
| SPC-1 | P2 | 参数值未做数值过滤：字符串/空值直接进入 `xbarR`/`capability`，产生 NaN 控制限 | `getParamData` / `spcMonitor` 统一 `Number()` + `Number.isFinite` 过滤 |
| SPC-2 | P2 | 规格上下限（USL/LSL）只读"最新一行 custom_json"，最新行没写该参数规格时，之前设置过的规格丢失 → Cpk/超差判异失真 | 改为按时间倒序回溯最近 50 行，找到该参数 spc 定义为止 |
| SPC-3 | P2 | 监控分析取数 `ORDER BY recorded_at DESC`（倒序），趋势/连续规则方向相反（"连续 6 点上升"被当成下降） | 先取最近 200 条，再按时间正序分析 |

### 1.3 实测

```
SPC 可分析节点: 3（首个：采购下单 #147，200 条温度数据）
GET /api/spc/analyze?...&param=temperature_c&subgroup_size=5
→ 200：子组 40、WECO 告警 2、Cpk 1.15、规格 220/300
```

遗留（P3，数据治理）：96 条告警全部未确认（建议批量确认/清理规则）；只有 3 个节点有参数数据，且"采购下单"节点也有温度数据（采集口径需梳理）。

## 2. 维护 TPM 链路

### 2.1 现状

`maintenance_plans`（5 计划，全部 pending，4 条已超期）→ 完成维保 → `maintenance_logs` → `spare_parts`（5 备件，4 条低库存）→ 看板（`/api/maintenance/dashboard`、`/api/field-service/dashboard`）→ 故障报修（3 条，2 条未闭环）。

### 2.2 发现与整改

| 编号 | 级别 | 问题 | 整改 |
|---|---|---|---|
| MNT-1 | **P1** | **完成维保后计划被永久置 `completed`**：`next_due_date` 虽更新，但计划状态不是 active/pending，后续超期/即将到期/看板全部不再统计 → 周期性维保只生效一次 | 完成后勤计划保持 `active`，`next_due_date = 今天 + frequency_days`（空频率默认 30 天） |
| MNT-2 | **P1** | **备件消耗链路断裂**：完成维保不扣备件、不写 `maintenance_spare_parts`（表 0 行），库存永远不减少 | 完成接口支持 `spares:[{spare_part_id,quantity}]`：写关联表 + 扣 `spare_parts.quantity`，库存不足整体回滚（事务） |
| MNT-3 | P2 | **超期口径失效**：fieldService 只统计 `status='active'`，而计划实际是 `pending`；且用 UTC 日期 → 看板超期恒为 0（假健康） | 统一为 `status IN ('active','pending')`，日期用本地 `date('now','localtime')` |
| MNT-4 | P2 | **MTBF 实际是 MTTR**：`AVG(downtime_hours)` 被当作 MTBF 返回 | 分开计算：`mttr_hours = 总停机/故障数`；`mtbf_hours = (90×24 − 总停机)/故障数`；新增 `breakdown_failures` |

### 2.3 实测（修复后，真实 API）

```
备件 before: 液压滤芯 HX-100 qty=2
POST /api/maintenance/plans/1/complete {spares:[{spare_part_id:2,quantity:1}]}
→ 200 {plan_status:"active", next_due_days:7, spares_consumed:[{...×1}], log_id:6}
备件 after: qty=1
计划 after: status=active, next_due_date=2026-11-12, last_done_date=2026-11-05
维护仪表板: overdue_plans=3（修复前 0）、upcoming_7d=1、logs_30d=2、mtbf_hours=null、mttr_hours=0
/api/field-service/overdue → 3 条
```

演练数据已回滚（计划恢复 pending/2026-07-01、备件恢复 2、删除演练日志与关联行）。

## 3. 成本链路

### 3.1 现状

`erp_cost_ledger`（1 条）→ `POST /api/erp/cost-rollup`（生成项目成本）→ `project_cost_entries`（4 条人工成本，合计 30500）→ `/equipment_instances/:id/cost_rollup`（汇总）→ `/equipment_instances/:id/cost_variance`（三层差异：材料量差/价差 + 人工效率差/费率差）。

### 3.2 复核结果

```
POST /api/erp/cost-rollup {instance_id:1} → 200 {entries_created:3, total_debit:165}
GET  /api/equipment_instances/1/cost_rollup → 200（合同额/预算/实际/材料人工分项）
GET  /api/equipment_instances/1/cost_variance → 200（material_lines/labor/data_gaps 齐备）
GET  /api/project_cost_entries/summary → 200（labor 4 条 30500，其它类型 0）
```

- 三层差异接口此前已按"没数据不算节约"原则加固（`available/data_gaps/not_computed`），本次复核逻辑与字段一致；
- 无新增代码缺陷。

### 3.3 数据治理建议（P3）

1. `materials.estimated_unit_price/actual_unit_price` 大量为 0 → 材料价差/量差全为 0，需要补主数据价格；
2. 成本结构目前只有人工（4 条 30500），材料/外协/折旧/返工应有台账或从 ERP 导入；
3. `erp_cost_rollup` 可重复调用（实测 entries_created=3 但未产生重复台账），建议在 UI 上明确"重新汇总"语义。

## 4. 改动文件

| 文件 | 说明 |
|---|---|
| `services/spcService.js` | 数值过滤、规格限回溯 |
| `services/spcMonitor.js` | 时间正序 + 数值过滤 |
| `services/maintenanceDashboardService.js` | 完成维保保持 active、备件消耗、超期本地日期 |
| `services/fieldService.js` | 超期/即将到期状态口径、MTBF/MTTR 拆分 |

## 5. 复验

```bash
# 维护
curl -X POST /api/maintenance/plans/<id>/complete -d '{"spares":[{"spare_part_id":2,"quantity":1}]}'
curl /api/field-service/dashboard          # overdue_plans 应按真实数据 >0

# SPC
curl '/api/spc/analyze?process_node_id=147&param=temperature_c'

# 成本
curl -X POST /api/erp/cost-rollup -d '{"instance_id":1}'
curl /api/equipment_instances/1/cost_variance
```
