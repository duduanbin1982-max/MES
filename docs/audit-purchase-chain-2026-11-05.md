# 采购链路深挖报告（采购单 → 审批 → 收货 → 入库 → 对账）

> 审计日期：2026-11-05  
> 审计方式：6 张存量采购单数据核对 + 全代码走读（`services/purchase` 1119 行 + 前端采购页 986 行）+ 真实 API 链路演练（7 步 25 项检查）  
> 演练脚本：`scripts/acceptance-purchase-chain.js`（`npm run acceptance:purchase`）

## 0. 结论

**链路已打通（7/7 步、25/25 项检查通过）**；深挖发现 **2 个 P1 + 4 个 P2**，已全部整改。

| 项目 | 结果 |
|---|---|
| 存量采购单 | 6 张：draft 1 / confirmed 2 / in_transit 1 / partially_received 2 |
| 链路演练 | 创建 → 提交 → 审批 → 部分收货 → 来料检验放行 → 全收 → 发票 → 对账 → 关闭，**7/7 步、25/25 项** |
| 测试 | `purchase.test.js` 6/6 + 新增 `purchaseChain.test.js` 6/6 |
| 全量部署闸门 | **761/0** |

## 1. 链路现状（走读结论）

```
创建(draft) → 提交(submitted) → 审批(confirmed, approved_by) → 发运(in_transit)
   → 收货(partially_received / received)  ← 自动生成批次 + 待检库存(quarantined) + 库存流水 + 关键件价格
   → 来料检验(pass/fail)                  ← 供应商协同：pass 放行(available)、fail 生成 NCR 并保持隔离
   → 发票(purchase_invoices) → 对账(三单匹配) → 关闭(closed)
```

- 收货 → 批次/库存/流水/关键件价格：`services/purchase/orderRoutes.js` 已实现（含超量拦截、事务回滚）；
- 来料检验：`services/supplierCollaboration` 的 `incoming-inspections`，回写收货/批次/库存质量状态；
- **对账：原实现完全缺失**（无发票表、无对账接口、无 UI）。

## 2. 发现与整改

| 编号 | 级别 | 问题 | 整改 |
|---|---|---|---|
| PUR-1 | **P1** | **状态机无校验**：`PATCH /purchase_orders/:id/status` 接受任意 catalog 状态，可 `draft→received`、`closed→draft`；`partially_received/received` 可手工设置；确认不需要审批人，无职责分离 | 增状态转移表：`draft→submitted→confirmed→in_transit`，`received→closed`，终态不可回退；收货派生状态只能由收货接口推进；确认必须带 `approved_by` 且**审批人 ≠ 创建人**；非法流转返回 400 + `allowed_transitions` |
| PUR-2 | **P1** | **对账缺失**：无发票表/接口/UI，无法做"订单-收货-发票"三单匹配 | 新增 `purchase_invoices` 表 + `POST /purchase_orders/:id/invoices` + `GET /purchase_orders/:id/reconciliation`（已订/已收/已开票/差异/是否全收）+ 发票状态流转（pending→matched→paid/void）；前端详情抽屉新增「对账」区与「录入发票」表单 |
| PUR-3 | P2 | **批次供应商恒为 null**：收货写 `material_lots.supplier` 时用 `po.supplier_id ? null : null` | 改为按 `supplier_id` 查供应商名写入批次，测试断言校验 |
| PUR-4 | P2 | **创建校验不足**：物料不存在会 FK 失败 500；数量/单价可为 0/负数 | 创建前校验物料存在（404）、数量 > 0、单价 ≥ 0；金额四舍五入 2 位 |
| PUR-5 | P2 | **详情无收货历史**（前端 `receiving_history` 一直是空） | 详情接口返回 `receiving_history`（含物料/数量/时间/质量状态）与 `reconciliation` 汇总 |
| PUR-6 | P2 | **新表建不出来**：`purchase_invoices` 的 DDL 在服务 register 阶段被 serviceMigrations 抑制（存量库 schema 已登记），运行期直接 500 | 新增 `scripts/migrate-purchase-invoices.js --apply`（幂等）并已在生产执行；`purchase` schemaVersion 2→3 + 重新生成指纹 |

### 2.1 对账接口示例

```http
GET /api/purchase_orders/8/reconciliation
{
  "summary": {
    "ordered_amount": 1000, "received_amount": 1000, "invoiced_amount": 1000,
    "variance": 0, "status": "matched", "fully_received": true, "invoice_count": 1,
    "ordered_qty": 10, "received_qty": 10
  },
  "lines": [ { "ordered_amount": 1000, "received_amount": 1000, "remaining_qty": 0, ... } ],
  "invoices": [ { "invoice_no": "INV-...", "amount": 1000, "status": "matched" } ]
}
```

状态：`pending`（未开票）/ `matched`（差异 ≤ 0.01）/ `variance`（有差异）。

## 3. 链路演练（真实 API，生产库）

脚本 `npm run acceptance:purchase`：创建采购单 → 提交 → 审批（职责分离）→ 部分收货 → **来料检验 pass → 库存由 quarantined 变 available** → 全收 → 录发票 → 对账 matched → 关闭；跑完自动清理（含发票/收货/批次/库存/流水/检验）。

最近一次运行：

```
✅ 1. 创建采购单（draft）
✅ 2. 提交 → 审批（approved_by，职责分离）
✅ 3. 收货 → 待检隔离（部分收货）
✅ 4. 来料检验 → 放行（pass）
✅ 5. 全部收货 → received
✅ 6. 发票 → 对账（三单匹配）
✅ 7. 关闭采购单
=== 采购链路演练：7/7 步，25/25 项检查 ===
```

关键中间状态（脚本断言）：收货后库存 `quarantined`、检验 pass 后 `available`；批次记录供应商名；对账 `ordered=received=invoiced=1000`、差异 0。

## 4. 未整改 / 建议

| 编号 | 级别 | 说明 |
|---|---|---|
| PUR-7 | P3 | 收货质量状态写 `pass/fail`，批次写 `passed/failed`（两套词），建议统一为 `passed/failed` |
| PUR-8 | P3 | **存量数据治理**：6 张 PO 的 `approved_at` 全为 null，但状态已是 confirmed/in_transit/partially_received——历史数据绕过审批；建议补录审批记录或重走流程 |
| PUR-9 | P3 | 双明细表：`po_lines`（在用）与 `purchase_order_items`（空置），建议后续迁移合并并删表 |
| PUR-10 | P3 | `schemaVersion` 调高不会对存量库补跑 DDL（本次已用迁移脚本解决），新表/新列建议一律配迁移脚本 |

## 5. 改动文件

| 文件 | 说明 |
|---|---|
| `services/purchase/orderRoutes.js` | 状态机、创建校验、收货供应商、详情（收货历史+对账）、发票/对账接口 |
| `middleware/apiPermissions.js` | 对账读、发票写权限 |
| `scripts/migrate-purchase-invoices.js` | 存量库建 `purchase_invoices` |
| `scripts/acceptance-purchase-chain.js` | 采购链路演练脚本 |
| `tests/purchaseChain.test.js` | 新增 6 个用例（状态机/职责分离/创建校验/全链路/对账差异/发票约束） |
| `tests/purchase.test.js` | 适配新状态机（提交→审批带 approved_by） |
| `frontend/src/views/purchase/{PurchaseOrdersTab.vue,usePurchaseOrders.ts}`、`PurchaseManagement.vue` | 对账区 + 录入发票 + 审批人 |
| `services/registry/core.js`、`db/service-schema-manifest.json` | purchase schemaVersion 3 + 指纹 |
| `package.json` | `acceptance:purchase` |
