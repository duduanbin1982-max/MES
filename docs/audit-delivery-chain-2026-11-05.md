# 交付链路深挖报告（里程碑 → 交付单 → 验收签署 → 收款 → 看板）

> 审计日期：2026-11-05  
> 审计方式：代码走读（`services/delivery` 824 行 + `services/tbmAdvanced` + 前端交付看板）+ 数据核对 + 真实 API 链路演练（6 步 19 项检查）  
> 演练脚本：`scripts/acceptance-delivery-chain.js`（`npm run acceptance:delivery`）

## 0. 结论

**链路已打通（6/6 步、19/19 项检查通过）**；发现 **1 个 P1 + 2 个 P2**（另有 4 个 P3），已全部整改核心项。

| 项目 | 结果 |
|---|---|
| 存量数据 | `delivery_orders` 1 条（planned）、`acceptance_records` 1 条（passed，但未关联交付单/里程碑）、`contract_milestones` 1 条（pending）、`project_payments` 1 条（milestone_id 空） |
| 链路演练 | 创建交付单 → 发运/到达 → 合同里程碑 + 验收单 → 客户签署 passed → **交付单自动 accepted、里程碑 completed** → 收款登记 → 看板汇总，**6/6 步、19/19 项** |
| 测试 | 新增 `deliveryChain.test.js` **4/4** |
| 全量部署闸门 | **777/0** |

## 1. 链路现状（走读结论）

```
合同里程碑（contract_milestones）
  → 交付单（POST /equipment_instances/:id/deliveries，状态机 planned→shipped→in_transit→arrived→accepted/cancelled）
  → 验收单（POST /equipment_instances/:id/acceptances，FAT/SAT/终验）
  → 客户签署（POST /acceptances/:id/sign，passed/conditional/rejected，必须签署人）
  → 收款（POST /project-payments，关联里程碑）
  → 项目汇总（/project-summary/:id）+ 交付看板（/delivery/overview）
```

交付单状态机与验收签署校验本来就有（此前 2026-11-02 补的单据表），**断点在"验收结论不驱动交付/收款状态"**。

## 2. 发现与整改

| 编号 | 级别 | 问题 | 整改 |
|---|---|---|---|
| DLV-1 | **P1** | **验收签署与交付单/里程碑不联动**：签署 `passed` 后交付单仍停在 `arrived`（甚至 `planned`），合同里程碑仍 `pending` → 看板显示"已验收"但交付单没完成，收款也无从对账 | 签署 passed/conditional 时：交付单若为 `arrived` → 自动 `accepted` 并写实际日期；里程碑置 `completed`；不满足前置状态时返回 `warnings` 提示 |
| DLV-2 | P2 | **交付看板缺交付/验收/回款维度**：`/delivery/overview` 只有项目数/进度/风险/异常，没有交付单、验收、回款数据 | overview 增加 `summary.deliveries / acceptances / payments`；前端看板新增 4 张 KPI：交付单（已交付/在途）、验收（通过/让步/拒收）、已回款、回款率 |
| DLV-3 | P2 | **收款登记校验不足**：`amount` 可 ≤0、项目可不存在、里程碑可跨项目挂、凭证号可重复、收款日期为空 | 校验金额 > 0、项目存在、里程碑归属一致、凭证号唯一（409）、日期默认本地日期 |
| DLV-4 | P3 | 交付单 `actual_date` 用 `toISOString()`（UTC），早 8 点前会记成前一天 | 改用 `todaySqlDate()` 本地日期；验收签署时间同样修正 |
| DLV-5 | P3 | 存量数据断链：验收单 1 条 `delivery_order_id/milestone_id` 均为空；收款 1 条 `milestone_id` 空；合同里程碑无计划日期 | 数据治理建议（报告列出，未改历史数据） |
| DLV-6 | P3 | 双验收表：`acceptance_checklists`（旧，tbmAdvanced 在用）与 `acceptance_records`（新，交付模块用）并存 | 建议统一到 `acceptance_records`，旧表只读归档 |
| DLV-7 | P3 | 交付/验收单无权限细分（走 equipment:read/write），未区分销售/客户代表 | 建议按角色细分（销售只读、项目经理可签收） |

## 3. 链路演练（真实 API，实例 #8）

`npm run acceptance:delivery`：

```
✅ 1. 创建交付单（planned）
✅ 2. 发运 → 到达（状态机 + 实际日期）
✅ 3. 合同里程碑 + 验收单（关联交付单）
✅ 4. 客户签署 passed → 联动交付单/里程碑
✅ 5. 收款登记 + 项目汇总
✅ 6. 交付看板汇总（交付/验收/回款）
=== 6/6 步，19/19 项检查 ===
```

关键断言：签署后交付单 `arrived → accepted`；合同里程碑 `pending → completed`；重复凭证号 409；看板 `/delivery/overview` 的 `deliveries/acceptances/payments` 均有值。跑完自动清理演练数据。

## 4. 测试覆盖（`tests/deliveryChain.test.js` 4/4）

1. 交付单状态机：planned→shipped 记录本地实际日期；shipped→accepted 拒绝；
2. 验收签署 passed：交付单 arrived→accepted、里程碑 completed；
3. 签署校验：signer 必填、conditional 必须填 condition_note、rejected 不改交付单；
4. 收款校验：金额 ≤0 / 项目不存在 / 里程碑跨项目 / 凭证号重复；正常收款日期为本地日期。

## 5. 改动文件

| 文件 | 说明 |
|---|---|
| `services/delivery/records.js` | 验收签署联动交付单/里程碑、warnings、本地日期 |
| `services/delivery/routes.js` | overview 增加交付/验收/回款汇总 |
| `services/tbmAdvanced/projectDashboard.js` | 收款登记校验（金额/项目/里程碑归属/凭证号/日期） |
| `frontend/src/views/DeliveryDashboard.vue` | 新增 4 张 KPI 卡（交付单/验收/已回款/回款率） |
| `tests/deliveryChain.test.js` | 新增 4 个用例 |
| `scripts/acceptance-delivery-chain.js` | 交付链路演练脚本 |
| `package.json` | `acceptance:delivery` |

## 6. 复验方式

```bash
npm run acceptance:delivery       # 演练并自动清理
node --test tests/deliveryChain.test.js
```

前端：`/delivery` 看板 → 第二行 KPI（交付单 / 验收 / 已回款 / 回款率）；`/tbm-advanced?tab=accept` 处理验收单。
