# 设备台账拆分与车间设备台账实施报告

> 日期：2026-11-10  
> 方案：方案 A（项目装备台账 / 车间设备台账拆分）  
> 代码：`frontend/src/views/EquipmentLedger.vue`、`ProjectEquipmentLedger.vue`、`services/equipment/ledgerRoutes.js`  
> 结论：**已按方案 A 完成第一阶段；全量闸门 951/0。**

## 1. 问题定性

原 `/equipment-ledger` 页面读取 `equipment_instances`（TBM 项目产品），而真正的车间生产设备在 `equipment` 表。两个实体混用，导致：

- 页面显示的是“郑州地铁盾构机、顶管机”，不是“激光切割机、折弯机、焊机、镗床、行车”；
- 客户、合同、交付、项目进度等字段占满设备台账；
- 真正的车间设备（7 台）没有台账入口；
- 维保/OEE 表按 `equipment_instance_id` 关联，是项目装备维保，不是车间设备维保。

因此不是补字段能解决，必须拆实体。

## 2. 已完成：页面与路由拆分

| 页面 | 路由 | 数据源 | 用途 |
|---|---|---|---|
| **车间设备台账** | `/equipment-ledger` | `equipment` + `workstations` + `iot_devices` | 车间生产设备主数据 |
| **项目装备台账** | `/project-equipment-ledger` | `equipment_instances` | TBM 项目产品、生命周期、客户、合同、交付 |

- 原页面复制为 `ProjectEquipmentLedger.vue`，保留此前的 S1 归一、归档、合同额、交付验收、CSV 导出等能力；
- 菜单“设备与维护 / 设备台账”指向车间设备新页；
- 菜单“项目与装备 / 项目装备台账”指向原项目页；
- `/instances` 项目装备列表和详情保持不变。

## 3. 已完成：车间设备台账基础版

### 3.1 数据模型

新增迁移 `029_equipment_ledger_fields.sql`，扩展 `equipment`：

```text
asset_no, manufacturer, model, serial_no, location,
criticality, purchase_date, warranty_end,
responsible_user_id, notes, updated_at
```

- `asset_no` 回填为 `code`；
- 新增资产编号唯一索引。

### 3.2 API

新增：

```text
GET    /api/equipment-ledger/meta
GET    /api/equipment-ledger
GET    /api/equipment-ledger/:id
POST   /api/equipment-ledger
PUT    /api/equipment-ledger/:id
POST   /api/equipment-ledger/:id/status
DELETE /api/equipment-ledger/:id
```

能力：

- 关键词搜索：编码/名称/资产/型号/序列号/厂商；
- 筛选：设备类型、状态、工位、是否含退役；
- 汇总：总数、运行、空闲、维保、故障、离线、退役、IoT 在线；
- CRUD：编码/资产编号唯一校验、工位校验、状态/关键度枚举；
- 状态机：`running/idle/maintenance/fault/offline/retired`；
- 删除保护：存在关联 IoT 采集点时禁止删除；
- 权限：`equipment:read` / `equipment:write`。

### 3.3 页面

- KPI：设备总数、运行中、维保/故障、IoT 在线；
- 筛选：关键词、设备类型、状态、工位、含退役；
- 表格：设备/资产号、类型/工位、状态、型号/序列号、厂商/关键度、最近保养、IoT 在线数；
- 新增/编辑：编码、名称、类型、资产号、工位、状态、厂商、型号、序列号、关键度、位置、购置/保修、最近保养、备注；
- 状态变更弹窗；
- 删除二次确认；
- 角色 `admin/foreman` 可见写操作。

## 4. 生产数据

### 车间设备（7 台，全部来自 `equipment`）

| 设备 | 类型 | 工位 | 状态 | IoT |
|---|---|---|---|---:|
| 激光切割机 2 万瓦 | 激光切割机 | 激光切割工位 | 空闲 | 5 个采集点（0 在线） |
| 1000 吨折弯机 | 折弯机 | 折弯/卷制工位 | 空闲 | 1 个（0 在线） |
| CO2 焊机 1 | 焊机 | 焊接工位 1 | 空闲 | 0 |
| 焊接机器人 1 | 焊接机器人 | 焊接工位 1 | 空闲 | 0 |
| 落地镗床 | 镗床 | 镗孔工位 | 空闲 | 0 |
| 50t 行车 | 行车 | 装配工位 A | 空闲 | 0 |
| 试压平台 | 试压平台 | 调试工位 | 空闲 | 0 |

- 车间设备 7 台、工位 9 个、IoT 采集点 7 个（6 个有 `equipment_id` 关联，全部离线）；
- 项目装备仍为 5 台，只在 `/project-equipment-ledger` / `/instances` 展示。

### 项目装备（5 台，独立入口）

`/project-equipment-ledger` 仍显示项目装备 5 台、生命周期、合同、交付验收，与车间设备完全分开。

## 5. 验证

| 项目 | 结果 |
|---|---|
| `tests/equipmentLedger.test.js` | 1/1（项目台账 S1/归档/逾期） |
| 新增 `tests/equipmentLedgerCrud.test.js` | 1/1（车间设备列表/汇总/CRUD/状态/删除） |
| 全量部署闸门 | **951/0** ✅ |
| 生产 `/api/equipment-ledger` | 7 台车间设备，汇总 7/0/0/0，IoT 6 个关联 |
| 生产 `/api/equipment-ledger/meta` | 6 状态、7 类型、9 工位 |
| 迁移 029 | 已执行；资产编号唯一索引建立 |
| Playwright `/equipment-ledger` | 7 行车间设备、KPI、筛选、新增入口正常，无 pageerror |
| Playwright `/project-equipment-ledger` | 5 行项目装备、S1 已归一，无 pageerror |

## 6. 第二阶段（未做，建议下一轮）

维保与 OEE 不能直接复用现有表，因为：

- `maintenance_plans/logs` 现在按 `equipment_instance_id` 关联，是 TBM 项目装备维保；
- `oee_shift_log` 现在按 `equipment_instance_id` 关联，是项目装备 OEE；
- 直接改成 `equipment_id` 会污染项目侧数据。

建议新增：

```text
equipment_maintenance_plans  (equipment_id, ...)
equipment_maintenance_logs   (equipment_id, ...)
equipment_oee_shift_log      (equipment_id, ...)
equipment_status_logs        (equipment_id, ...)
```

第二阶段页面增加：

- 维保计划/到期提醒/保养登记；
- 设备 OEE（可用率/性能/质量）趋势；
- 故障/停机记录；
- IoT 实时状态与最后上报；
- 资产原值、折旧、保修到期。

## 7. 仍需注意

1. **设备主数据仍很薄**：厂商、型号、序列号、位置、购置/保修日期当前为空，资产号临时等于编码，需要业务补录。
2. **IoT 映射疑似错位**：例如“盾构机主控PLC”“焊接温度传感器”挂在 EQ-001（激光切割机）上；“刀盘振动”挂在 EQ-002（折弯机）上，需要核对 `iot_devices.equipment_id`。
3. **现有维保/OEE 属于项目装备**，不能直接显示在车间设备页；第二阶段需新表。
4. **设备状态全部为 idle**，没有运行/维保/故障数据；状态页可用但缺少真实状态流。
5. **暂无分页/服务端大数据量优化**；当前 7 台足够，设备规模上来后加分页。
6. **删除为物理删除**，已加 IoT 关联保护；后续建议改为退役/软删除并保留履历。

## 8. 复验

1. `/equipment-ledger`：应显示 7 台车间设备（激光切割机、折弯机、焊机、焊接机器人、镗床、行车、试压平台）；
2. `/project-equipment-ledger`：应显示 5 台 TBM 项目装备（郑州/杭州盾构机、顶管机、演练机）；
3. 车间设备页新增一台设备 → 填写资产号/型号/工位 → 保存；
4. 改状态为维保 → KPI 维保 +1；
5. 删除有 IoT 关联的设备应被拒绝；
6. `node --test tests/equipmentLedgerCrud.test.js tests/equipmentLedger.test.js`。
