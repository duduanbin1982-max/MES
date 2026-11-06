# 工时与报工模块审计报告

> 审计对象：`/process-hours`（工时与报工：工时定额 / 工序报工 / 日汇总 / 完工进度 / 工人绩效 / 加班统计）  
> 审计日期：2026-11-06  
> 审计方式：代码走读（`services/processHoursService.js` 185 行 + `processHours/analyticsRoutes.js` 147 行 + 前端 294 行 composable 260 行）+ 生产接口实测 + 多角色权限矩阵 + 报工闭环演练  
> 生产数据：`work_report_details` 2 条（清理前）、`process_standard_hours` 3 条（含 2 条脏行）、`process_executions` 6 条

## 0. 结论摘要

**整改前评级：C+** —— 核心问题不是"功能少"，而是**填报链路对现场工人不可用 + 数据无校验 + 绩效指标算错**。

**整改后：A-（4 个 P1 + 4 个 P2 已修）**

| 编号 | 级别 | 问题（整改前实测） | 状态 |
|---|---|---|---|
| WH-1 | **P1** | 报工接口无校验：`hours_spent=-3`、`999`、`0`、不存在的工单（99999）全部返回 200 并写库 | 已修 |
| WH-2 | **P1** | 权限错配：`POST /work-reports` 要求 `work_order:write`，**工人/焊工没有该权限 → 现场无法报工**；而工时定额写接口（`/process/nodes/:id/hours`）无任何规则 → 任意登录角色可改 | 已修 |
| WH-3 | **P1** | 工人绩效公式错误：标准工时 = 实际工时 × 8，导致效率恒为 **12.5%** | 已修 |
| WH-4 | **P1** | 工时定额无节点/数值校验，生产库存在 `process_node_id='undefined'` 脏行 | 已修 + 数据清理 |
| WH-5 | P2 | 报工无法撤销；错误报工永久生效，`actual_hours` 被覆盖 | 已修（DELETE + 重算） |
| WH-6 | P2 | 日期口径 UTC：日汇总默认日期、绩效/加班默认区间、前端默认日期都按 UTC 取，早 8 点前会算到前一天 | 已修（本地日期） |
| WH-7 | P2 | `hours-summary.nodes` 按行计数（一个节点多条定额被重复计数）；完工进度用"实际工时/标准人时"冒充完成率 | 已修 |
| WH-8 | P2 | 数据完整性：2 条报工指向不存在的工单（WO#1），日汇总会把这些"幽灵工时"算进去 | 已清理 |
| WH-9 | P3 | 工时双轨：`process_executions.hours_worked` 与 `work_report_details.hours_spent` 互不同步，项目进度只取前者 | **已修**（报工优先/执行兜底） |
| WH-10 | P3 | 加班阈值硬编码 8h，无班次/节假日日历 | **已修**（work_calendar + 日历加班） |
| WH-11 | P3 | 报工无审批流/月结锁定，填报即生效 | **已修**（pending→审批 + 月结锁定） |
| WH-12 | P3 | 历史报工 `worker_id` 可能为空 | **已修**（迁移脚本回填） |

## 1. 模块现状（走读）

```
工时定额 process_standard_hours（节点 × 工种 → 标准工时 × 人数）
  → 工序报工 work_report_details（工时/数量/质量/报工人）
  → 工单实际工时 work_orders.actual_hours（报工合计）
  → 日汇总 / 完工进度 / 工人绩效 / 加班统计
```

前端 `/process-hours` 六个页签：工时定额、工序报工、日汇总、完工进度、工人绩效、加班统计。

生产数据核对：
- `work_report_details` 2 条，均指向 `work_order_id=1`，但**工单表没有 id=1**（实际为 2/3/4/7）→ 无效报工；
- `process_standard_hours` 3 条：1 条有效（节点 1，装配 8h×1），2 条 `process_node_id='undefined'`（脏行）；
- 也就是说：**报工模块此前在生产上没有一条有效数据**，页面"能开"但链路没跑通。

## 2. 发现与整改明细

### WH-1（P1）报工无校验

原实现只判断 `hours_spent != null`。实测：负工时、999 小时、0 小时、不存在的工单全部 200 入库。

整改后校验：
- 工单必须存在（404）；
- `0 < hours_spent <= 24`（单次报工上限，`MAX_SINGLE_REPORT_HOURS` 可配）；
- 数量 ≥ 0、完成数量 ≤ 总数、完成率 0–100；
- `quality_result ∈ pass/fail/rework`；
- 工序节点必须存在且**属于该工单的装备实例**；
- `work_order_operations.id`（如传）必须存在；
- 插入 + 工单 `actual_hours` 重算放在同一事务里。

### WH-2（P1）权限错配

- `POST /work-reports` 原来要求 `work_order:write`：worker/welder 没有 → **工人无法报工**（这正是本模块的核心用户）；
- 工时定额写接口没有权限规则 → 任意登录角色（仓库除外）都能改标准工时。

整改：
- 新增权限 `work_report:read` / `work_report:write`；
- 报工读写：worker、welder、foreman、planner、production_supervisor；qc/engineer 只读；
- 工时定额写收口到 `process:write`（工程师/车间主任/生产主管），读放给 `process:read` / `work_report:read`；
- 存量 7 个角色已通过 `scripts/migrate-work-report-permissions.js --apply` 补齐。

实测（生产）：worker 报工 200；worker 改定额 403；engineer 改定额 200。

### WH-3（P1）工人绩效公式错误

原 SQL：`(SUM(hours_spent) * 8.0) AS standard_hours_calc`，效率 = 实际 / 标准 = **恒 12.5%**。

整改：标准工时改为取该工人报工所涉及工序的**工时定额合计**（`process_standard_hours`，按节点去重），效率 = 标准 / 实际 × 100；无定额时返回 `null`（前端显示"无定额"），不再给假百分比；接口同时返回 `summary.avg_efficiency / total_hours_sum / total_tasks / workers_with_standard`。

实测：定额 4h + 报工 2h → `standard_hours=4, efficiency=200%, summary.avg_efficiency=200`。

### WH-4（P1）工时定额无校验 → 脏数据

`POST /process/nodes/:id/hours` 不校验节点是否存在：实测 `POST /api/process/nodes/undefined/hours` 返回 200，`process_node_id` 落成字符串 `"undefined"`。生产库已有 2 条此类脏行（已清理）。

整改：节点必须是正整数且存在（404）；标准工时 > 0 ≤ 10000；人数 1–100 整数；`work_type` 白名单；PUT 批量接口整体校验后再替换（失败不落库）。

### WH-5（P2）报工不可撤销

新增 `DELETE /api/work-reports/:id`：删除后在同一事务内重算该工单 `actual_hours`；权限 `work_report:write`。前端报工列表新增「撤销」按钮（无权限显示 —）。

### WH-6（P2）日期 UTC 口径

日汇总默认日期、绩效/加班默认区间（最近 30 天）、前端 `dailyDate` 全部改为**本地日期**；`/work-reports` 的 `end_date` 过滤补足 `23:59:59`（原来只写日期会漏掉当天记录）。

### WH-7（P2）汇总口径

- `hours-summary.nodes` 改为按节点去重（原来按行数，节点多工种会重复计数）；
- 完工进度：优先「完成数量 / 总数」，没有数量数据时退化为「工时消耗率」，并同时返回 `completion_pct` 与 `hours_ratio_pct`。

### WH-8（P2）幽灵工时清理

`work_report_details` 2 条记录指向不存在的工单 WO#1。新增 `scripts/migrate-clean-work-hours.js`（`--apply`）：清理孤儿定额行 + 孤儿报工行，异常工时（≤0 或 >24）只报告不自动删。生产已执行：**删除孤儿报工 2 条**。

## 3. 验证

| 项目 | 结果 |
|---|---|
| `tests/processHoursGovernance.test.js`（新） | **7/7**（报工校验/跨实例工序/撤销重算/定额校验/绩效公式/完工进度/节点去重） |
| 前端 | ESLint 0、vue-tsc 0、build 通过 |
| 全量部署闸门 | **788/0** |
| 生产权限矩阵（实测） | worker 报工 200 / 改定额 403；engineer 改定额 200；admin 全通 |
| 生产报工闭环（实测） | 报工 2h → 工单 actual_hours=2 → 绩效 standard=4、efficiency=200% → 撤销 → actual_hours 重算；演练数据已清理 |
| 数据治理 | 孤儿报工 2 条已删除；孤儿定额 0 条（此前手工清理） |

## 4. 改动文件

| 文件 | 说明 |
|---|---|
| `services/processHoursService.js` | 报工/定额校验、撤销、本地日期、汇总与进度口径 |
| `services/processHours/analyticsRoutes.js` | 绩效标准工时改取定额、本地日期、加班阈值可配、summary 字段 |
| `app/permissions.js` | 新增 work_report:read/write + 默认角色 |
| `middleware/apiPermissions.js` | 报工/定额/汇总/进度权限规则 |
| `frontend/src/composables/useProcessHoursPage.ts` | 本地日期、撤销报工、绩效空值/汇总 |
| `frontend/src/views/ProcessHours.vue` | 撤销按钮、绩效空值展示 |
| `scripts/migrate-work-report-permissions.js` | 存量角色补权限（幂等） |
| `scripts/migrate-clean-work-hours.js` | 孤儿定额/报工清理（幂等） |
| `tests/processHoursGovernance.test.js` | 7 个回归用例 |

## 5. P3 遗留治理（第二轮，2026-11-06 已完成）

### 5.1 WH-9 工时双轨 → 报工优先、执行工时兜底

- 项目进度 `GET /api/equipment_instances/:id/process_progress`：实际工时优先取**已审批报工**合计，无报工数据时回退 `process_executions`；响应新增 `hours.actual_basis`；
- 工序效率 `GET /api/process_nodes/:id/efficiency` 同口径，新增 `actual_basis`；
- 实测：节点无报工时 `actual_basis=process_executions`；审批 3h 报工后 `actual_basis=work_reports`、`actual=3`；
- 保留 `process_executions` 作为扫码/工序动作的过程记录（不删除），口径文档化为"**报工是工时唯一真源，执行记录只做兜底与过程**"。

### 5.2 WH-10 班次/节假日日历

- 新增 `work_calendar(date, day_type, daily_hours)` 与 API：`GET/POST/DELETE /api/work-calendar`（写权限 `work_report:approve`）；
- 加班统计按日历：工作日阈值 8h（`OVERTIME_DAILY_HOURS` 可配）、周末/节假日阈值 0（全部计加班）；返回 `day_type` 与当日 `standard_hours`；
- 实测：工作日 2h → 加班 0；把当天设为节假日后 → 2h 全部计加班。

### 5.3 WH-11 报工审批流 + 月结锁定

- 新报工默认 `pending`；`PUT /api/work-reports/:id/approve`（`work_report:approve`）通过后才计入实际工时/绩效/日汇总；`PUT /api/work-reports/:id/reject` 必须填原因；
- 新增 `work_month_locks` + API `/api/work-report-locks`：锁定月份禁止新增/审批/撤销报工；
- 实测：锁定当月后新增报工 400、审批 400，提示"报工月份 2026-11 已月结锁定"；解锁后恢复；
- 前端：报工列表新增状态列、通过/驳回按钮、本月锁定/解锁按钮。

### 5.4 WH-12 历史 worker_id 回填

`scripts/migrate-work-hours-governance.js --apply`：新增审批字段/月结表/日历表，并按 `reported_by → 工单 assigned_to → 工序执行人` 回填历史 `worker_id`；生产库当前 0 条待回填。

### 5.5 报工工时 → 人工成本自动入账

- 审批通过时写 `project_cost_entries`（`cost_type=labor`、`source_ref=work_report:<id>:labor`、金额 = 工时 × 人工费率），费率取 `system_settings.labor_rate_per_hour` → 环境变量 → 默认 200；
- 驳回/撤销按 `source_ref` 冲销；重复审批幂等，不重复入账；
- 实测：2h 报工审批 → 成本 **400 元**入账（200 元/h）；撤销后成本行 0、工单 `actual_hours` 2→0；
- 模块边界白名单已登记 `processHoursService -> project_cost_entries`，边界检查通过。

### 5.6 验证汇总

| 项目 | 结果 |
|---|---|
| `tests/processHoursGovernance.test.js` | **11/11**（含审批/成本/月结/日历/口径/回填） |
| 全量部署闸门 | **792/0** |
| 模块边界检查 | 通过 |
| 前端 eslint / vue-tsc / build | 0 / 0 / 通过 |
| 生产演练 | pending→审批→成本 400→锁定拦截→日历加班→撤销冲销；演练数据已清理 |

### 5.7 当前边界（仍未做）

1. 成本入账使用统一人工费率（单值），未按工种/技能等级差异化；
2. 月结锁定记录 `locked_by`，但没有审批流/双人复核；
3. 日历只有单日配置，无批量导入/法定节假日模板；
4. 报工审批无通知（站内/IM）；
5. 报工只联动人工成本，材料/外协/折旧仍由其他台账维护。

## 6. 第二轮改动文件

| 文件 | 说明 |
|---|---|
| `services/processHoursService.js` | 审批/驳回、月结锁定、日历、成本入账、撤销冲销、approved 口径 |
| `services/processHours/analyticsRoutes.js` | 只统计 approved、日历加班 |
| `services/process/progress.js` | 实际工时：报工优先、执行兜底（actual_basis） |
| `services/process/node/nodeActions.js` | 工序效率同口径 |
| `app/permissions.js` / `middleware/apiPermissions.js` | 新增 `work_report:approve` 及审批/月结/日历规则 |
| `config/moduleBoundaries.json` | 登记 `processHoursService -> project_cost_entries` |
| `scripts/migrate-work-hours-governance.js` | 审批字段 + 月结/日历表 + worker_id 回填（幂等） |
| `scripts/migrate-work-report-permissions.js` | 存量角色补 `work_report:approve` |
| `frontend/.../useProcessHoursPage.ts`、`views/ProcessHours.vue` | 审批/驳回、月结锁定、状态列 |
| `tests/processHoursGovernance.test.js` | 11 个回归用例 |
