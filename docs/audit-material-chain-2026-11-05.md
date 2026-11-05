# 物料链路深挖报告（BOM 需求 → 领料 → 库存扣减 → 批次追溯）

> 审计日期：2026-11-05  
> 审计方式：代码走读（`services/pick` 572 行 + `services/material*` + `services/trace` 1000 行）+ 库存/批次数据核对 + 真实 API 链路演练（5 步 15 项检查）  
> 演练脚本：`scripts/acceptance-material-chain.js`（`npm run acceptance:material`）

## 0. 结论

**链路已打通（5/5 步、15/15 项检查通过）**；发现 **1 个 P1 + 3 个 P2**，已全部整改。

| 项目 | 结果 |
|---|---|
| 库存/批次数据 | `inventory` 4 行、`material_lots` 20 个、`material_movements` 5 条；库位分散（A-01 / A-02） |
| 链路演练 | BOM 需求（pick-list）→ 领料扣库存 + issue 流水 → 退料恢复 + return 流水 → 批次追溯（forward/chain）→ 隔离批次不可领，**5/5 步、15/15 项** |
| 测试 | 新增 `materialChain.test.js` **6/6** |
| 全量部署闸门 | **767/0** |

## 1. 链路现状（走读结论）

```
BOM 需求（/work_orders/:id/pick-list）
  → 领料（POST /work_orders/:id/pick）  ← 校验剩余需求、批次物料匹配、库位可用库存
  → 库存扣减（inventory.quantity -= qty）+ issue 流水（material_movements: work_order_id/operator/lot）
  → 退料（POST /work_orders/:id/return）← 可退数量 = Σissue − Σreturn，库存回加 + return 流水
  → 批次追溯（/trace/forward?lot_no= 汇总使用记录；/trace/chain?wo_code= 工序链路）
```

- 领料要求 `inventory.status = 'available'`，来料检验不合格的批次库存为 `quarantined`（正常不可领）；
- 追溯按 `material_lot_id + work_order_id` 串起来，能回溯到「哪张工单用了哪个批次」。

## 2. 发现与整改

| 编号 | 级别 | 问题 | 整改 |
|---|---|---|---|
| MAT-1 | **P1** | **退料把不合格批次"洗白"**：`return` 时无条件 `status='available'`；批次事后被判不合格（或待检）时，退料后又能被领用 | 退料按批次 `quality_status` 回写：`passed → available`，其它（failed/pending）→ `quarantined` |
| MAT-2 | P2 | **超领/超退开关任何调用方都能用**：`allow_over_pick / allow_over_return` 直接读 body，前端/脚本传 true 即绕过剩余需求/可退数量校验 | 仅 `admin / foreman / planner` 可开启（`isSupervisor` 判定），其它角色传了也无效 |
| MAT-3 | P2 | **"有库存却报库存不足"**：领料默认库位 `主仓库-A-01`，库存若在 A-02 则直接报"库存不足"，错误信息不提示其它库位 | 错误信息补充"该批次在其它库位有库存: A-02 40，请指定 location" |
| MAT-4 | P2 | 来料检验不合格批次仅靠库存状态兜底，若库存被人为改成 available 仍可领 | 领料时再校验 `material_lots.quality_status = failed` → 拒绝 |

## 3. 链路演练（真实 API）

`npm run acceptance:material`：用生产库存/批次做一次「领 5 → 退 2」并回滚：

```
✅ 1. BOM 需求（pick-list）            字段：wo_id / wo_code / total_items / done_items
✅ 2. 领料 → 库存扣减 + issue 流水     40 → 35，流水绑定 lot#2 / WO#3 / operator
✅ 3. 退料 → 库存恢复 + return 流水    35 → 37
✅ 4. 批次追溯（forward / chain）      forward 查到 WO 使用记录；chain 可读
✅ 5. 不合格/隔离批次不可领料          quarantined 批次被拒且有原因
=== 5/5 步，15/15 项检查 ===
```

跑完自动回滚库存数量、删除本次流水（`--keep` 可保留）。

## 4. 未整改 / 建议

| 编号 | 级别 | 说明 |
|---|---|---|
| MAT-5 | P3 | 领料是**部分成功语义**：同一请求里逐条处理，一条失败不影响其它条（errors + results 同时返回），无整体事务回滚。建议前端明确提示"部分成功"，或提供严格模式 |
| MAT-6 | P3 | 批次追溯 `forward` 只聚合 issue/transfer；退料不计入"使用记录"（业务上合理），但追溯页可加退料历史 |
| MAT-7 | P3 | 领料/退料未校验单位（unit）换算，数量按原单位直接加减；多单位物料需走 `material_units` 换算 |
| MAT-8 | P3 | 库存 4 行中 1 行（主轴承）数量为 0、1 行隔离，可用库存偏少；建议随现场数据补齐 |

## 5. 改动文件

| 文件 | 说明 |
|---|---|
| `services/pick/shared.js` | `isSupervisor`（admin/foreman/planner） |
| `services/pick/transactions.js` | 退料质量状态回写、拒绝 failed 批次、超领/超退仅主管、库位库存提示 |
| `tests/materialChain.test.js` | 新增 6 个用例（扣减+流水/非主管超领/库存不足/不合格批次/退料+超退/退料质量回写） |
| `scripts/acceptance-material-chain.js` | 物料链路演练脚本 |
| `package.json` | `acceptance:material` |

## 6. 复验方式

```bash
npm run acceptance:material     # 生产库存/批次上跑一遍并回滚
node --test tests/materialChain.test.js
```

前端：`/shopfloor`（车间工作台领料）、`/materials`（库存与流水）、`/trace`（按批次/工单追溯）。
