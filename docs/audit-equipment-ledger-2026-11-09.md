# 设备台账模块审计报告

> 日期：2026-11-09  
> 模块：`/equipment-ledger`「设备台账」  
> 代码：`frontend/src/views/EquipmentLedger.vue`、`services/resourceService/summaryRoutes.js`  
> 结论：**发现 3 个 P0、5 个 P1；本轮修复 8 项，新增回归 1 条，全量闸门 950/0。**

## 1. 审计范围

- 设备/装备实例列表、生命周期、状态、进度、客户；
- 汇总 KPI（总数、进行中、完成/交付、延期风险）；
- 型号/类型、序列号、项目号、合同、计划日期、交付/验收；
- 归档设备、筛选搜索、导出；
- 生命周期 S1 历史数据与统一状态目录；
- 接口权限、测试与生产数据。

## 2. 审计前问题

### P0-1：生命周期 S1 原样显示

生产库有 2 台设备：

```text
status = design
lifecycle_stage = S1
```

前端台账使用硬编码生命周期表，没有使用统一状态目录的 `S1 → design` 别名，页面直接显示 **“S1”**；筛选“设计中”也匹配不到这两台设备。

### P0-2：汇总 KPI 口径矛盾

旧 `/api/resources/equipment`：

- `completed` 只统计 `delivered/operation/completed`，**排除 `archived`**；
- 但页面副标题写“交付、运维或归档状态”；
- `in_progress` 排除 archived，`completed` 也不含 archived → 归档设备既不算进行中，也不算完成；
- `delayed` 只统计 `status='delayed'`，**不统计计划完成已过期**，也不统计 `lifecycle_stage='delayed'`；
- 页面 fallback `summary.delayed || delayedCount` 在部分延期时仍会漏计。

### P0-3：台账字段不足，名不副实

旧接口只返回：

```text
id, instance_code, instance_name, status, lifecycle_stage, progress_pct, customer_name
```

页面却声称“查看生命周期、客户、进度与交付状态”，实际没有：

- 型号/类型；
- 序列号、项目号；
- 合同号/合同额；
- 计划开始/完成；
- 交付单状态、验收结果；
- 归档状态。

## 3. P1 问题

| 编号 | 问题 | 处理 |
|---|---|---|
| E-04 | 生命周期选项前端硬编码，与后端/domain 状态目录会漂移 | 改用前端 `domain/statusCatalog` 的 `EQUIPMENT_LIFECYCLE_OPTIONS` / `META` |
| E-05 | 归档设备没有“含归档”开关，也不显示归档标识 | 增加“含归档”开关、归档标签；接口支持 `include_archived` |
| E-06 | 搜索只覆盖编码/名称/客户 | 扩展到型号、序列号、项目号、合同号 |
| E-07 | 台账不能导出 | 增加 CSV 导出（当前筛选结果） |
| E-08 | 设备台账无回归测试 | 新增 `tests/equipmentLedger.test.js` |

## 4. 本轮修复

### 4.1 接口补全

`GET /api/resources/equipment` 现在返回：

- `equipment_models.model_code/model_name`、`equipment_types.name_zh`；
- `serial_no/project_no/contract_no/contract_amount/contract_amount_unit`；
- `planned_start/planned_end`；
- `archive_status/is_terminal/is_overdue`；
- 最新 `delivery_orders.status`（交付状态）；
- 最新 `acceptance_records.result`（验收结果）；
- `lifecycle_stage_normalized`：`S1 → design`。

### 4.2 汇总口径

| 指标 | 新口径 |
|---|---|
| `total` | 当前筛选结果总数 |
| `active` | 非 archived |
| `in_progress` | 非终态（design/procurement/manufacturing/assembly/commissioning/acceptance/delayed） |
| `completed` | delivered/operation/completed/archived（**归档计入完成**） |
| `archived` | archive_status=archived |
| `delayed` | 延期状态 或 `planned_end < 今天` 且未完成 |

### 4.3 S1 数据修复

新增迁移 `028_normalize_lifecycle_s1.sql`：

```sql
UPDATE equipment_instances
   SET lifecycle_stage = 'design'
 WHERE lifecycle_stage = 'S1';
```

生产 2 台 S1 已回写为 design；前端/后端同时保留别名兼容。

### 4.4 页面增强

- 生命周期选项改用统一状态目录，S1 显示“设计中”；
- 新增型号/类型、序列号/项目号、合同号+合同额、计划完成、交付/验收列；
- “含归档”开关 + 归档标签；
- 搜索覆盖更多字段；
- CSV 导出；
- 延期风险统计使用 `is_overdue`。

## 5. 修复后生产数据

| 指标 | 数值 |
|---|---:|
| 设备总数 | 5 |
| 进行中 | 5 |
| 已完成/交付 | 0 |
| 归档 | 0 |
| 延期风险 | 0 |
| S1 原始值 | 0（已归一到 design） |
| 有交付单 | 2（TBM-2026-001 accepted、TBM-DEMO-001 planned） |
| 有验收记录 | 2（pending、passed） |

### 交付/验收数据说明

生产存在口径不一致：

- `TBM-2026-001`：交付单 `accepted`，但验收 `pending`；
- `TBM-DEMO-001`：交付单 `planned`，验收 `passed`。

台账同时展示两个字段，不再隐藏矛盾；业务需确认交付/验收流程先后。

## 6. 验证

| 项目 | 结果 |
|---|---|
| 新增 `tests/equipmentLedger.test.js` | **1/1**（S1 归一、归档计入完成、逾期、筛选） |
| 全量部署闸门 | **950/0** ✅ |
| 生产 `/api/resources/equipment` | 5 台；S1 归零；型号/序列号/合同/计划/交付/验收字段返回 |
| 迁移 028 | 已执行，S1 全部回写 design |
| 前端 eslint / typecheck / build | 通过（已部署） |
| Playwright `/equipment-ledger` | 5 行、KPI 5/5/0/0、S1 不再显示、导出/含归档可用，无 pageerror |

## 7. 仍需注意

1. 本模块是**项目装备实例台账**，不是财务固定资产台账；尚无资产原值、折旧、存放地点、保修期等字段。
2. 页面搜索/生命周期筛选仍是**前端过滤**（接口已支持 `keyword/stage/include_archived`，后续可接服务端分页）。
3. 台账无分页，设备量大时需要服务端分页/虚拟滚动。
4. 交付单与验收记录是两套单据，当前生产存在 accepted+pending、planned+passed 不一致，需要业务梳理状态机。
5. 归档设备默认显示（含归档开关）；如经营口径只看在役设备，可默认关闭“含归档”。
6. 生命周期 S1 已修，但其他历史别名（designing/purchasing）仍由 domain 兼容，未做全库扫描。

## 8. 复验

1. `https://192.168.1.73/equipment-ledger` → Ctrl+Shift+R；
2. 确认 5 台设备、生命周期全部显示“设计中”，不再出现 S1；
3. 查看型号/序列号/项目号/合同额/计划完成/交付/验收列；
4. 关闭“含归档”，确认归档设备被过滤（当前生产无归档）；
5. 点击“导出”，CSV 包含当前筛选结果；
6. `node --test tests/equipmentLedger.test.js`。
