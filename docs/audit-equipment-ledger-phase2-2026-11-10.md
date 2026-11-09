# 设备台账第二阶段实施报告

> 日期：2026-11-10  
> 范围：车间设备维保 / OEE / 状态履历 / 资产字段 / IoT 映射 / 分页与退役  
> 结论：**第二阶段代码与页面已完成；全量闸门 951/0。**

## 1. 本阶段解决的问题

| 问题 | 处理 |
|---|---|
| 维保/OEE 属于项目装备，不能复用到车间设备 | 新建 4 张 `equipment_*` 表，按 `equipment_id` 关联，项目装备表不动 |
| 没有维保计划/到期提醒/保养登记 | 新增计划、保养日志 API 和页面抽屉 |
| 没有设备 OEE | 新增 `equipment_oee_shift_log`、加权 OEE 汇总、趋势条和班次录入 |
| 没有故障/停机记录 | 新增 `equipment_status_logs`，状态变更/新增/退役写履历 |
| IoT 实时状态/最后上报 | 详情抽屉展示绑定采集点；`production_equipment_id` 与项目 `equipment_id` 分离 |
| 资产原值/折旧/保修 | `equipment` 增加原值、折旧方式、年限、残值率、投产日期、退役字段；列表/表单/详情展示 |
| 设备主数据薄 | 增加完整性提示；厂商/型号/序列号/位置/购置日期可在编辑中补录 |
| 无分页 | API 支持 limit/offset，页面增加分页 |
| 物理删除 | 改为**退役软删除**：保留设备、维保、OEE、状态履历 |

## 2. 数据模型

新增迁移 `030_equipment_maintenance_oee.sql`：

### equipment 扩展字段

```text
original_value, depreciation_method, depreciation_years, residual_rate,
commission_date, retired_at, retire_reason, updated_at
```

### 新表

```text
equipment_maintenance_plans  (equipment_id, plan_code, plan_name, maintenance_type,
                              frequency_days, next_due_date, last_done_date, status, ...)
equipment_maintenance_logs   (equipment_id, plan_id, performed_at, hours_spent,
                              findings, actions_taken, parts_replaced, next_due_at, ...)
equipment_oee_shift_log      (equipment_id, shift_date, planned_minutes, operating_minutes,
                              ideal_cycle_time, total_output, good_output, ...)
equipment_status_logs        (equipment_id, from_status, to_status, reason, changed_by, changed_at)
```

### IoT 映射修正

审计发现 `iot_devices.equipment_id` 的外键实际指向 **equipment_instances（项目装备）**，不是车间 `equipment`。之前把项目传感器挂到车间设备上会造成二次错位。

处理：

- 保留 `equipment_id` 的项目装备语义；
- 新增 `iot_devices.production_equipment_id`，车间设备只读这个字段；
- 现有项目传感器不做错误迁移；
- 车间设备页显示“未接入”，直到业务绑定 `production_equipment_id`。

## 3. API

```text
GET    /api/equipment-ledger                     # 分页 + 筛选
GET    /api/equipment-ledger/meta
GET    /api/equipment-ledger/maintenance/due      # 全局到期
GET    /api/equipment-ledger/:id
POST   /api/equipment-ledger
PUT    /api/equipment-ledger/:id
POST   /api/equipment-ledger/:id/status           # 写状态履历
GET    /api/equipment-ledger/:id/status-logs
GET    /api/equipment-ledger/:id/maintenance
POST   /api/equipment-ledger/:id/maintenance/plans
POST   /api/equipment-ledger/:id/maintenance/logs
GET    /api/equipment-ledger/:id/oee
POST   /api/equipment-ledger/:id/oee
POST   /api/equipment-ledger/:id/retire
DELETE /api/equipment-ledger/:id                 # 软删除/退役
```

权限：`equipment:read` / `equipment:write`。

## 4. 页面

车间设备页新增：

- KPI：设备总数、运行、维保/故障、维保到期、IoT 在线；
- 列表：资产原值/折旧、下次维保/到期、IoT 在线、状态、工位、型号/序列号；
- 分页；
- 详情抽屉 4 个 Tab：
  - **概览 / IoT**：资产全字段、原值/折旧、保修、绑定 IoT 列表；
  - **维保**：计划、到期、保养记录、新增计划/保养登记；
  - **OEE**：可用率/性能/质量/OEE、最近 12 期趋势条、班次记录、录入班次；
  - **状态履历**：新增、编辑状态、故障/维保/退役记录；
- 主数据完整性提示；
- 维保到期提醒；
- 退役原因弹窗（软删除）。

## 5. 生产现状

| 指标 | 数值 |
|---|---:|
| 车间设备 | 7 |
| 维保计划 | 0 |
| 保养记录 | 0 |
| OEE 班次 | 0 |
| 状态履历 | 0 |
| 车间设备 IoT 绑定 | 0 |
| 项目装备 IoT（旧 `equipment_id`） | 7 个采集点，保持项目装备语义 |

代码能力已就绪；以下属于**业务数据尚未录入**，不是功能缺失：

- 7 台设备的厂商/型号/序列号/位置/购置日期仍为空，页面显示完整性告警；
- 尚无车间设备维保计划/保养记录；
- 尚无车间设备 OEE 班次；
- 尚无状态变更履历，设备全部为 idle；
- 尚无 `production_equipment_id` 绑定，IoT 显示“未接入”。

## 6. 验证

| 项目 | 结果 |
|---|---|
| `tests/equipmentLedgerCrud.test.js` | 1/1（列表/汇总/CRUD/状态/维保计划/保养/OEE/软退役） |
| `tests/equipmentLedger.test.js` | 1/1（项目台账 S1/归档/逾期） |
| `serviceSchemaUpgrade` | 通过（031 改为服务初始化字段，不再依赖迁移顺序） |
| 全量部署闸门 | **951/0** ✅ |
| 生产 `/api/equipment-ledger` | 7 台；分页/汇总正常 |
| 生产 `/api/equipment-ledger/1/maintenance` | 空计划/记录正常 |
| 生产 `/api/equipment-ledger/1/oee` | 空班次正常，汇总 0 |
| Playwright 车间设备页 | 7 行、详情四个 Tab、维保按钮、OEE 录入入口、无 pageerror |

## 7. 仍需业务补录/后续

1. **主数据**：厂商、型号、序列号、位置、购置/投产/保修日期、资产原值；资产号当前仍等于编码。
2. **维保**：为 7 台设备建立保养计划，设置周期/负责人/下次到期。
3. **OEE**：按班次录入计划/运行分钟、节拍、产量、合格数，才有趋势。
4. **状态流**：目前全 idle；运行/故障/维保需现场状态回写或人工变更。
5. **IoT 绑定**：确认哪些采集点属于车间设备，绑定到 `production_equipment_id`；项目传感器继续用 `equipment_id`。
6. **折旧**：当前提供原值/方式/年限/残值率与年折旧参考，未生成逐月折旧台账/净值曲线。
7. **附件/审批**：维保报告、备件、审批流未纳入本阶段。

## 8. 复验

1. `/equipment-ledger`：7 台设备、分页、主数据缺失提示；
2. 点“详情”→ 概览/维保/OEE/状态履历四个 Tab；
3. 维保 Tab：新增计划；再保养登记；列表应更新；
4. OEE Tab：录入班次，趋势条/汇总应出现；
5. 改状态为故障再恢复，状态履历应两条；
6. 退役一台设备：列表状态变“退役”、记录仍保留；
7. `node --test tests/equipmentLedgerCrud.test.js tests/equipmentLedger.test.js`。
