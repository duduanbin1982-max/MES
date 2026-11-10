# 项目装备维护入口实施报告

> 日期：2026-11-11  
> 路由：`/project-equipment-maintenance`  
> 结论：**已新增“项目装备维护”入口，旧 TBM 维保数据重新可见；`/maintenance` 重定向到该页；全量闸门 952/0。**

## 1. 背景

“设备与维护”全部切换为车间生产设备后，旧项目装备（TBM）TPM 数据被隔离：

| 旧项目 TPM 数据 | 数量 |
|---|---:|
| maintenance_plans | 5 |
| maintenance_logs | 6 |
| maintenance_checklists | 1 |
| breakdown_reports | 3 |
| spare_parts | 5 |

为了不丢失项目侧维保数据，新增独立入口，与车间设备维护彻底分开。

## 2. 实现

### 路由/菜单

- 新增 `/project-equipment-maintenance`，标题“项目装备维护”；
- 放在“项目与装备”菜单；
- 旧 `/maintenance` 重定向到 `/project-equipment-maintenance`；
- “设备与维护”下仍只有车间设备台账、点检/TPM、维保计划、现场服务、备件库。

### 页面

复用原 `MaintenanceDashboard.vue`，改为“项目装备维护”：

- 顶部筛选：项目装备实例；
- KPI：维保计划、7 天内到期、故障报修、备件库存、维保记录、现场服务；
- Tab：
  - 维保计划（含完成操作，写旧 `maintenance_plans/logs`）；
  - 故障报修；
  - 备件库存；
  - 维保记录；
  - **点检表（新增）**；
  - 现场服务。

### API

复用已有：

```text
GET  /api/maintenance/dashboard
POST /api/maintenance/plans/:id/complete
```

补充权限：

```text
/maintenance/dashboard       equipment:read
/maintenance/plans/:id/complete equipment:write
```

## 3. 生产数据可见性

页面当前显示：

| 指标 | 数值 |
|---|---:|
| 维保计划 | 5（逾期 4） |
| 7 天内到期 | 0 |
| 故障报修 | 3（待处理 2） |
| 备件库存 | 5（低库存 4） |
| 维保记录 | 6 |
| 点检表 | 1 |
| 现场服务 | 1 |

项目装备下拉显示 TBM 项目实例；与车间设备 TPM 完全分离。

## 4. 验证

| 项目 | 结果 |
|---|---|
| 全量部署闸门 | **952/0** ✅ |
| 生产 `/api/maintenance/dashboard` | 200；5 计划/4 逾期、3 故障/2 待处理、5 备件/4 低库存、6 记录、1 点检 |
| Playwright `/project-equipment-maintenance` | 标题“项目装备维护”，KPI 5/0/3/5/6/1，6 个 Tab，无 pageerror |
| `/maintenance` | 重定向 `/project-equipment-maintenance` |
| 权限 | equipment:read / equipment:write |

## 5. 仍需注意

1. 该入口主要是**只读聚合 + 完成维保计划**；没有新增计划、点检表、故障报修的完整 CRUD，如需项目侧维护需继续扩展。
2. 旧项目备件与车间备件已分成两套：项目 `spare_parts`、车间 `equipment_spare_parts`，不再混用。
3. 项目装备维护的现场服务仍来自旧 `field_service` 表。
4. “设备与维护”菜单已全为车间设备；项目装备维护在“项目与装备”下。
5. 旧 `/maintenance` 不再作为独立页面，统一进入项目装备维护。

## 6. 复验

1. “项目与装备”菜单出现“项目装备维护”；
2. 打开 `/project-equipment-maintenance`：计划 5、故障 3、备件 5、记录 6、点检 1；
3. 完成一条维保计划，生成旧 `maintenance_logs` 并顺延；
4. `/maintenance` 自动跳转到项目装备维护；
5. “设备与维护 / 点检 TPM”仍然只有 EQ-001…EQ-007 车间设备；
6. `bash scripts/pre-deploy-test.sh`。
