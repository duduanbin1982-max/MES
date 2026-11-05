# 交付治理整改报告（DLV-5 / DLV-6 / DLV-7）

> 整改日期：2026-11-05（承接《交付链路深挖报告》遗留 P3）  
> 目标：把三项遗留全部关闭——存量数据断链、双验收表、交付/验收权限细分

## 0. 结论

**三项全部关闭并验证：**

| 编号 | 原问题 | 结果 |
|---|---|---|
| DLV-5 | 验收单未关联交付单/里程碑、收款无里程碑、里程碑无计划日期 | **剩余缺口全部为 0**（自动补建 + 回填） |
| DLV-6 | `acceptance_checklists`（旧）与 `acceptance_records`（新）并存 | 旧表数据已迁移并归档；`/acceptance-checklists` 端点改读写 `acceptance_records`（字段映射兼容原前端） |
| DLV-7 | 交付/验收/回款无独立权限，销售等角色可用 `equipment:write` 越权写 | 新增 `delivery:read / delivery:write`，10 个存量角色已补；实测**读全角色 200、写仅 admin/planner/foreman** |

## 1. DLV-5 存量数据断链治理

脚本：`scripts/migrate-delivery-linkage.js`（`--verify` 预览 / `--apply` 执行，幂等）

规则：
1. 验收单 `delivery_order_id` 空 → 关联同实例交付单（accepted > arrived > in_transit > shipped > 最近非取消）；
2. 验收单 `milestone_id` 空 → 同实例唯一合同里程碑时关联；**无里程碑时自动补建**「【自动补建】验收里程碑」；
3. 无交付单时自动补建 `DO-AUTO-<实例编码>-001`（标记【自动补建】）；
4. 收款 `milestone_id` 空 → 同实例唯一合同里程碑时关联；
5. `contract_milestones.planned_date` 空 → 实例计划开始日期；
6. `payment_amount` 为 0 且 `payment_pct > 0` → 合同额 × 比例。

执行结果（生产库）：

```
acceptance_records#1 delivery_order_id → 2（同实例交付单）
acceptance_records#3 milestone_id → 1
project_payments#1 milestone_id → 1
新建 contract_milestones（实例 8，【自动补建】验收里程碑，planned_date=2026-11-01）
新建 delivery_orders（实例 1，DO-AUTO-TBM-2026-001-001）
contract_milestones#1 planned_date → 2026-07-01
剩余缺口: {acceptance_missing_delivery:0, acceptance_missing_milestone:0,
          payment_missing_milestone:0, milestone_missing_date:0}
```

## 2. DLV-6 双验收表统一

脚本：`scripts/migrate-acceptance-unify.js`

- 旧表 `acceptance_checklists` → `acceptance_records`：`acceptance_no = AC-LEGACY-<id>`，`checklist_name/items` 以 `CHECKLIST:` JSON 编码进 `notes`，`result` 映射（pending/passed/conditional/rejected，failed→rejected），`inspector→signer_name`、`customer_rep→customer_name`、`sign_date→signed_at`；
- 迁移后旧表行 `status='archived'`（只读保留审计），重复执行幂等；
- **端点统一**：`services/tbmAdvanced/acceptance.js` 的 `/api/acceptance-checklists`（GET/POST/PUT/debug-hours）全部改为读写 `acceptance_records`，返回字段仍兼容原前端（`checklist_name/items/items_parsed/status/result/inspector/customer_rep/sign_date`）。

实测：`GET /api/acceptance-checklists` 返回 **2 条**（存量 `AC-TBM-DEMO-001-001` + 迁移的 `AC-LEGACY-1`），首条字段完整（含 `items`、`delivery_order_id`、`milestone_id`）。

## 3. DLV-7 权限细分

脚本：`scripts/migrate-delivery-permissions.js`（补存量角色）+ `app/permissions.js`（目录与默认角色）

新增权限：
- `delivery:read`：查看交付/验收/回款
- `delivery:write`：维护交付/验收/回款

角色分配：
| 权限 | 角色 |
|---|---|
| read + write | admin(*)、planner、foreman、production_supervisor |
| read | sales、engineer、qc、worker、welder、purchaser、warehouse |

接口规则（`middleware/apiPermissions.js`）：
- `/equipment_instances/:id/deliveries|acceptances`、`/deliveries/*`、`/acceptances/*`、`/acceptance-checklists/*`、`/project-payments`、`/contract-milestones`、`/project-summary` → `delivery:read / delivery:write`（不再走 equipment 权限）。

实测权限矩阵（交付单读/写）：

```
admin      read=200 write=200
planner    read=200 write=200
foreman    read=200 write=200
engineer   read=200 write=403
worker     read=200 write=403
qc         read=200 write=403
sales      read=200 write=403
warehouse  read=200 write=403
```

> 注意：JWT 里内嵌权限，**存量用户需重新登录**后新权限才生效（角色表已更新）。

## 4. 测试与验证

| 项目 | 结果 |
|---|---|
| `tests/deliveryGovernance.test.js`（新） | **4/4**（断链回填/占位补建/验收表统一/权限细分） |
| 迁移脚本重复执行 | 全部幂等（第二次 0 变更） |
| 全量部署闸门 | **781/0** |
| 生产实测 | 缺口 0；统一端点 2 条；权限矩阵符合预期 |

## 5. 改动文件

| 文件 | 说明 |
|---|---|
| `scripts/migrate-delivery-linkage.js` | DLV-5 断链回填 + 占位补建 |
| `scripts/migrate-acceptance-unify.js` | DLV-6 旧验收表迁移 |
| `scripts/migrate-delivery-permissions.js` | DLV-7 存量角色补权限 |
| `services/tbmAdvanced/acceptance.js` | 验收清单端点改读写 `acceptance_records`（字段映射） |
| `app/permissions.js` | 新增 delivery:read/write + 默认角色 |
| `middleware/apiPermissions.js` | 交付/验收/回款/里程碑路由改用 delivery 权限 |
| `tests/deliveryGovernance.test.js` | 4 个回归用例 |

## 6. 复验

```bash
node scripts/migrate-delivery-linkage.js --apply      # 幂等，第二次 0 变更
node scripts/migrate-acceptance-unify.js --apply
node scripts/migrate-delivery-permissions.js --apply
node --test tests/deliveryGovernance.test.js
```

前端：`/tbm-advanced?tab=accept`（验收清单已统一到新表）、`/delivery`（交付看板）；销售账号登录后只读（写操作 403）。
