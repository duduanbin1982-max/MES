# 设备与维护模块全量切换车间生产设备实施报告

> 日期：2026-11-10  
> 范围：设备与维护菜单下全部子模块  
> 结论：**除数字孪生（已移到项目与装备）外，设备台账、点检/TPM、维保计划、现场服务、备件库均切换为车间生产设备；全量闸门 952/0。**

## 1. 菜单与数据源

| 菜单子模块 | 数据源 | 说明 |
|---|---|---|
| 设备台账 | `equipment` | 7 台车间设备（激光切割机、折弯机、焊机、机器人、镗床、行车、试压平台） |
| 点检 / TPM | `equipment` + `equipment_maintenance_*` + `equipment_checklists` | 车间设备维保/点检 |
| 维保计划 | `equipment_maintenance_plans` | 车间设备计划 |
| 现场服务 | 同上 + `equipment_breakdowns` | 车间设备故障报修 |
| 备件库 | `equipment_spare_parts` | 车间设备通用备件 |
| 数字孪生 | `equipment_instances` | **已从“设备与维护”移到“项目与装备”**；它是 TBM 产品 3D 孪生，不是车间设备 |

因此“设备与维护”下不再出现项目装备（TBM）业务对象。

## 2. 数据模型

新增迁移 `032_equipment_tpm_tables.sql`：

```text
equipment_checklists      (equipment_id, checklist_name, check_type, items_json, ...)
equipment_breakdowns      (equipment_id, report_code, fault_type, fault_desc, severity,
                           status, downtime_hours, root_cause, repair_actions, ...)
equipment_spare_parts     (equipment_id, part_code, part_name, quantity, min_stock, ...)
```

复用：

```text
equipment_maintenance_plans (equipment_id, ...)
equipment_maintenance_logs  (equipment_id, ...)
```

旧表 `maintenance_plans/logs`、`spare_parts`、`breakdown_reports`、`maintenance_checklists` 是项目装备数据，**不再被本模块读写**；原数据保留，不影响项目侧。

旧项目备件已复制为车间通用备件（按 `part_code` 去重），当前 5 条。

## 3. API 改造

`/api/field-service/*` 全部改为车间设备：

| 接口 | 数据表 | 字段 |
|---|---|---|
| maintenance-plans | equipment_maintenance_plans | `equipment_id`、`equipment_code`、`equipment_name` |
| maintenance-logs | equipment_maintenance_logs | `equipment_id`、计划名、执行人 |
| maintenance-plans/:id/complete | equipment_maintenance_plans | 完成并顺延 |
| checklists | equipment_checklists | `equipment_id` |
| breakdowns | equipment_breakdowns | `equipment_id`、报修单号 |
| spare-parts | equipment_spare_parts | `current_stock` |

字段统一为 `equipment_id`，不再使用 `equipment_instance_id`。

## 4. 前端改造

- 维保计划表单装备下拉改为 `/api/equipment-ledger` 的 7 台车间设备；
- 计划/记录/点检/故障/备件列表显示车间设备编码/名称；
- 维保执行写 `equipment_maintenance_logs` 并完成车间设备计划；
- 点检表执行写车间设备维保记录；
- 故障报修写 `equipment_breakdowns`；
- 备件库读 `equipment_spare_parts`；
- 页面标题“点检 / TPM”，带 5 个 Tab。

## 5. 生产数据

| 数据 | 数量 |
|---|---:|
| 车间设备 | 7 |
| 车间维保计划 | 0 |
| 车间维保记录 | 0 |
| 车间点检表 | 0 |
| 车间故障单 | 0 |
| 车间备件 | 5（低库存 4） |
| 项目装备旧 TPM 数据 | 保留但不再展示 |

页面当前 KPI：逾期 0、待处理故障 0、点检表 0、低库存 4。

## 6. 验证

| 项目 | 结果 |
|---|---|
| `tests/fieldServiceTpm.test.js` | 1/1（车间计划/执行/筛选/点检/故障） |
| `serviceSchemaUpgrade` | 通过（032 新表） |
| 全量部署闸门 | **952/0** ✅ |
| 前端 eslint / typecheck / build | 通过（已部署） |
| 生产 `/api/field-service/*` | 计划0/记录0/点检0/故障0/备件5，全部 200 |
| Playwright | 标题“点检 / TPM”、设备下拉为 EQ-001…、5 Tab、备件5行、无 pageerror |
| 菜单 | 设备与维护仅设备台账/TPM/维保计划/现场服务/备件库；数字孪生在项目与装备 |

## 7. 仍需注意

1. **车间 TPM 业务数据为空**：计划、记录、点检、故障需现场补录；备件已从旧项目备件复制。
2. **旧项目 TPM 数据保留但不在本模块展示**：5 条项目计划、6 条记录、1 张点检表、3 条故障仍在旧表；如项目侧仍需使用，需要另建“项目设备维护”入口或后续迁移。
3. **数字孪生仍是 TBM 产品孪生**，已移到项目与装备；它不是车间设备 3D。
4. 车间设备主数据（厂商/型号/序列号/位置/资产原值）仍待补录。
5. 故障报修未接附件、审批、备件领用/OEE 自动扣减。
6. 维保/点检执行人使用用户 ID，默认当前用户。
7. 车间备件为通用库存，尚未按设备/库位做精细台账。

## 8. 复验

1. 菜单“设备与维护”只应有：设备台账、点检/TPM、维保计划、现场服务、备件库；数字孪生在“项目与装备”；
2. `/field-service`：设备下拉应为 EQ-001 激光切割机等车间设备，不再出现 TBM 项目；
3. 新建维保计划 → 选择 EQ-001 → 执行维保 → 记录写入车间设备；
4. 点检表执行、故障报修、备件出入库均作用于车间设备；
5. `/equipment-ledger` 维保 Tab 与 TPM 使用同一套 `equipment_maintenance_*` 数据；
6. `node --test tests/fieldServiceTpm.test.js tests/equipmentLedgerCrud.test.js`。
