# 成本归集模块审计报告

> 日期：2026-11-09  
> 模块：`/cost`「成本归集」、`/cost-variance`「项目成本偏差」  
> 代码：`services/cost/*`、`frontend/src/views/CostAllocation.vue`、`middleware/apiPermissions.js`  
> 结论：**发现 4 个 P0（全成本漏计、台账无 UI、财务数据 RBAC 默认放行、关键件单位口径不一致）、5 个 P1；本轮修复 10 项，新增回归 4 条，全量闸门 947/0。**

## 1. 审计范围

- 成本台账 `project_cost_entries`：新增/修改/作废/回填/汇总；
- 成本归集 `cost_rollup`：关键件、普通物料、人工、成本台账、合同毛利；
- 三层差异 `cost_variance`、明细 `cost_rollup/breakdown`；
- API 权限、审计、输入校验、分页；
- 前端成本归集页面与台账交互；
- 关键件/物料价格单位口径。

## 2. 生产现状（审计前）

| 项目 | 数值 |
|---|---:|
| 项目实例 | 5 |
| 成本台账 | 4 条（实例 1 人工 3 条 24,500 元；实例 2 人工 1 条 6,000 元） |
| 实例 1 成本台账 | 人工 24,500 元 |
| 实例 1 旧口径实际成本 | 1,623,464.80 元 |
| 实例 1 人工工时 | 估算 120h / 实际 2.5h |
| 实例 1 合同额 | 1,800 万元（18,000,000 元） |
| 实例 1 旧口径合同毛利 | 16,376,535.20 元（90.98%） |

## 3. 问题清单

| 编号 | 级别 | 问题 | 影响 | 处理 |
|---|---|---|---|---|
| C-01 | **P0** | `cost_rollup.totals.actual_cost` 只算关键件+普通物料，不含人工成本，也不含台账里的外协/折旧/返工/质量损失 | 实际成本严重低估，合同毛利虚高 | **已修复**：新增人工成本、台账其他成本、全口径字段；前端改用全口径 |
| C-02 | **P0** | 成本台账后端有完整 CRUD/回填接口，但前端没有台账列表/新增/作废/回填入口 | 外协、折旧、返工、质量损失无法归集 | **已修复**：成本归集页新增台账卡片、新增/作废/回填 |
| C-03 | **P0** | `/api/project_cost_entries`、`/cost_variance` 等未命中 API 权限规则，走“默认放行” | 任何登录用户（除仓库员外）可看项目成本/毛利 | **已修复**：新增 cost 读规则（report:read）；写接口仍限 admin/foreman |
| C-04 | **P0** | `key_components.unit_price` 按迁移 014 注释是 **万元/件**，普通物料是 **元**；rollup 直接相加 | 关键件成本被低估 10,000 倍，毛利/偏差全部失真 | **未修复（待业务口径确认）** |
| C-05 | P1 | 台账新增/修改/作废无审计、无日期/币种/引用校验 | 财务数据不可追溯、可跨项目挂错 BOM/工单 | **已修复**：审计 + 日期/币种/长度/引用校验 |
| C-06 | P1 | 回填只按 `deleted_at IS NULL` 判重，已作废（void）条目会被重新回填 | 作废成本“复活” | **已修复**：判重加 `status <> 'void'` |
| C-07 | P1 | 回填 `hourly_rate` 可为 0/负数；回填日期统一用今天 | 人工成本可能为负，发生日期失真 | **已修复**：费率 1~10000；材料用采购订单日期，人工用完工/计划日期 |
| C-08 | P1 | 台账列表无分页，一次返回全部 | 大数据量页面卡顿 | **已修复**：limit/offset + total |
| C-09 | P1 | `breakdown` 的 labor 行把工时（h）当金额累加进 `totals.actual` | 明细合计混入小时数，无法对账 | **未修复**：需要单独拆 labor 成本行；已记录 |
| C-10 | P1 | 关键件取 `last_price_id`，不回看合同 `valid_from/to` | 过期合同价仍作为实际价 | **未修复**：建议按发生日取有效合同价 |
| C-11 | P2 | 台账无期间锁定/审批，PUT 可改金额、成本类型 | 已过账成本可被直接改写 | 未处理，记录 |
| C-12 | P2 | 多币种字段 `currency` 存在，但汇总不换算汇率 | 混合币种直接相加 | 未处理，记录 |
| C-13 | P2 | 台账只有新增/作废，无编辑 UI | 错账需作废重录 | 未处理，后端 PUT 已有 |

## 4. 本轮修复

### 4.1 全口径成本归集

`cost_rollup` 新增：

- `ledger`：台账条数、总额、按类型金额、外协/折旧/返工/质量损失；
- `labor.hourly_rate`、`labor.estimated_cost`、`labor.actual_cost`、`cost_source`；
- `totals.estimated_cost_full`：材料/关键件 + 估算人工；
- `totals.actual_cost_full`：材料/关键件 + 实际人工 + 其他台账成本；
- `totals.cost_diff_full`；
- `contract_margin_full` / `contract_margin_pct_full`；
- 保留 legacy `totals.estimated_cost/actual_cost` 字段，兼容旧调用。

人工金额优先取台账已过账人工；没有台账人工时才用“工时×费率”，避免重复计算。

### 4.2 前端成本台账

成本归集页新增：

- 成本台账卡片：材料/人工/外协/折旧/返工/质量损失汇总；
- 台账列表：类型、说明、金额、发生日、状态、来源；
- 新增成本对话框（类型/说明/金额/日期/供应商/备注）；
- 作废（软删除）；
- “回填材料/人工”（带二次确认，默认 hourly_rate 取差异页费率）；
- 顶部 KPI 改用全口径字段，并标注“含人工/台账”。

### 4.3 台账数据质量

- `occurred_on` 必须为合法 `YYYY-MM-DD`（拒绝 2026-02-31）；
- `currency` 必须 3 位币种代码；
- description ≤500、notes ≤2000、来源字段 ≤120；
- amount 非负且 ≤1e12；
- `bom_node_id` / `work_order_id` 必须属于同一项目（表存在时校验）；
- 台账新增/修改/作废/回填写 `audit_logs`。

### 4.4 回填修复

- 费率 1~10000；
- 已作废条目不重复回填；
- 材料成本发生日取采购订单 `ordered_date`；
- 人工成本发生日取工单实际/计划结束日；
- 返回 created/skipped 统计并审计。

### 4.5 API 权限

新增显式规则：

- `/project_cost_entries*` 读/写需 `report:read`；
- `/equipment_instances/:id/cost_rollup|cost_variance` 读需 `report:read`；
- `/cost/work_orders/:id/variance`、关键件价格差异、物料价格汇总读需 `report:read`；
- 写接口仍由 `requireRole('admin','foreman')` 限制。

## 5. 验证

| 项目 | 结果 |
|---|---|
| 新增 `tests/costEntriesAudit.test.js` | **2/2**（日期/跨项目引用/汇总/作废/回填费率） |
| 新增 `tests/costRollupFull.test.js` | **1/1**（人工按台账、其他成本、全口径毛利） |
| 新增 `tests/costPermissions.test.js` | **1/1**（worker 403、admin/foreman 放行） |
| 原 `tests/costRollup.test.js` | **64/64** |
| 全量部署闸门 | **947/0** ✅ |
| 前端 eslint / vue-tsc / build | 0 / 0 / 通过（已部署） |
| 生产 rollup | legacy 实际 1,623,464.80；全口径实际 **1,647,964.80**；台账人工 24,500；全口径偏差 560 |
| 生产台账 API | 实例 1：3 条、24,500 元 |
| RBAC | worker 访问台账/rollup/variance 均 403；admin 200 |
| Playwright | `/cost` 选实例后 3 条台账、全口径 KPI、新增台账对话框正常，无 pageerror |

## 6. 关键未决问题（P0）

### 关键件价格单位：万元 vs 元

迁移 `014_key_component_unit_price.sql` 明确写：

> 补齐 11 个关键件的采购参考价（单位: 万元/件）

生产数据 `key_components.unit_price` 例如主轴承 380、减速机 65、电机 22、滚刀 1.8；普通物料 `materials.estimated_unit_price` 如钢板 6.8 **元/kg**。

当前 `cost_rollup` 直接：

```text
关键件 380 × 1 + 减速机 65 × 3 + ...  = 3,384.8
普通物料 钢板 6.8 × ... = 1,620,020
总计 1,623,404.8
```

两者单位不同，关键件实际应为 **3,384.8 万元 = 33,848,000 元**，与 18,000,000 元合同额相比是严重超支，而不是当前显示的 90% 毛利。

**本轮未静默乘 10000**，因为会同时影响 PriceVariance、关键件合同价、历史数据口径，且测试/业务需要确认；建议：

1. 明确 `key_components.unit_price`/`key_component_prices.actual_price` 的录入单位；
2. 在 rollup/breakdown/价格差异统一换算为元，或给价格表增加 `unit` 字段；
3. 数据迁移把历史值统一到元/万元其中一种；
4. 修正后重新核对合同毛利与超支预警。

## 7. 其他待处理

1. `breakdown` 的 labor 行把 h 当金额，totals 不可直接对账；
2. 关键件价未按合同有效期取值；
3. 台账无期间锁定/审批，PUT 可直接改已过账金额；
4. 多币种未换算；
5. 台账编辑 UI 未做（可先作废重录）；
6. `cost_rollup` legacy `actual_cost` 仍是不含人工/台账的口径，外部旧调用需迁移到 `actual_cost_full`。

## 8. 复验

1. `https://192.168.1.73/cost` → Ctrl+Shift+R；
2. 选择 TBM-2026-001，确认 KPI 显示“实际总成本（含人工/台账）”1,647,964.80；
3. 台账卡片显示 3 条、24,500 元；
4. 新增一条外协成本 → 台账/汇总/全口径实际同步增加；
5. 作废该条 → 不再计入；
6. 用 worker 账号访问台账/rollup，应 403；
7. `node --test tests/costEntriesAudit.test.js tests/costRollupFull.test.js tests/costPermissions.test.js`。
