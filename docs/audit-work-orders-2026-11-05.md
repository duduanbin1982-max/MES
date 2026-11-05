# 工单管理（/work-orders）模块审计报告

> 审计对象：factory-mes 自研「工单管理」模块  
> 审计日期：2026-11-05  
> 审计方式：代码走读（前端 380 行 + workOrderService 211 行 + 状态机/审计 148 行）+ 生产接口实测 + 权限矩阵实测 + 数据核对  
> 生产数据：4 张工单（2 completed / 1 in_progress / 1 pending）、1 条资源占用、3 条操作流水

## 0. 结论摘要

**总体评级：C（功能能跑，但用户可见文案大面积乱码、计划员被挡在派工之外、计划时间缺失导致资源视图丢工单）**  
**整改后：A（3 个 P1 + 6 个 P2 已修，生产工单计划日期已补齐）**

| 维度 | 评价 | 说明 |
|---|---|---|
| 文案与提示 | **差** | 服务里大量 `'??'` / `'?????'`；守卫用 `new ApiError(403, ...)` 参数错位 → 403 被包成 400，提示"车间主绡或审是员" |
| 权限一致性 | **差** | 计划员（主用户）有 `work_order:write`、页面有派工入口，但后端守卫只放行主任/管理员 |
| 计划时间 | **差** | 4 张工单 `planned_start` 全空、2 张只有 `planned_end`；列表"开始/结束"展示的是实际时间，计划负荷不可见 |
| 状态展示 | 差 | 状态机 6 状态，前端只认 4 个；缺 `dispatched` / `cancelled`；状态列直接显示英文 |
| 状态入口 | 中 | `cancel` 事件在状态机里定义了，但**没有任何接口/按钮**能触发 |
| 派工校验 | 差 | 不校验工单状态、人员在职、工位启用、重复派工；且先写库后校验，失败会残留计划时间 |
| 报工校验 | 中 | 工时/数量可为负；超报无提示 |
| 测试 | 中 | 状态机/派工/改工位有测试，但无权限、取消、补齐、报工校验测试 |

---

## 1. 模块结构

| 文件 | 作用 |
|---|---|
| `frontend/src/views/WorkOrders.vue` | 页面：工单列表（筛选/快捷筛选）、待派工 tab、齐套检查、派工弹窗、流转时间线抽屉 |
| `services/workOrderService.js` | 工单 API（列表/待派工/详情/创建/操作流水/流转/焊接/派工/改工位/报工） |
| `services/workOrder/stateMachine.js` | 状态机适配器 |
| `app/workflow/workOrderDefinition.js` | 状态与流转的唯一来源（6 状态：pending/dispatched/in_progress/paused/completed/cancelled） |
| `services/workOrder/workflowAudit.js` | 流转审计（workflow_instances / workflow_history） |

---

## 2. 发现清单

| 编号 | 级别 | 问题 | 影响 |
|---|---|---|---|
| F-01 | **P1** | 用户可见文案乱码 + 守卫错误构造 | `'??'`/`'?????'`；`new ApiError(403, msg)` 把 403 当 code → 实际返回 400，提示"车间主绡或审是员" |
| F-02 | **P1** | 计划员被挡住：页面有派工入口，后端只放行 foreman/admin | 计划员派工/创建/改工位全部失败 |
| F-03 | **P1** | 计划时间缺失且列表不展示计划 | 4 张工单 planned_start 全空；列表"开始/结束"是实际时间；`/multi-schedule` 等按计划时间的功能丢工单 |
| F-04 | P2 | 状态机 6 状态，前端只认 4 个 | `dispatched`/`cancelled` 无中文/无标签色/筛选缺失；状态列显示英文 |
| F-05 | P2 | 取消工单无入口 | 状态机有 `cancel`，接口 404，工单无法作废 |
| F-06 | P2 | 派工校验缺失 + 先写后校验 | 可对已完成/已取消工单派工；可派停用人员/停用工位；同一人可被重复派工；校验失败时计划时间已被写入 |
| F-07 | P2 | 报工无负数/超报校验 | 负工时/负数量入库；超计划无提示 |
| F-08 | P2 | 前端错误取 `data.error` | 后端返回 `message`，页面永远显示"派工失败"泛化提示 |
| F-09 | P2 | 无新建/详情/取消 UI；创建接口不支持 planned_end/priority/description | 工单只能靠外部脚本/接口建；看不到计划/实际/流水全貌 |
| F-10 | P3 | 工单与工序（process_nodes）无关联 | 工单工时/进度无法回挂工序计划，与项目排程两张皮 |
| F-11 | P3 | 列表无分页/排序；优先级显示数字 | 数据量小时可接受，规模上来要补 |

---

## 3. 关键证据（整改前）

### F-01 文案/状态码

```js
// middleware/guards.js（整改前）
throw new ApiError(403, '需要车间主绡或审是员权限');  // 参数顺序错：403 被当作 code，status 默认 400
```

实测：`PUT /work_orders/4/dispatch` as planner → **400** `{"code":403,"message":"需要车间主绡或审是员权限"}`（状态码与 code 不一致）。

服务内：`'user_id ??'`、`'?????'`、`'???? dispatched/in_progress ?????'`、`'wo_code/equipment_instance_id/title ??'`。

### F-03 计划时间

```
id 2 completed   planned_start=null  planned_end=2026-06-17 08:02:35  est=80
id 3 in_progress planned_start=null  planned_end=2026-06-11 08:03:28  est=40
id 4 pending     planned_start=null  planned_end=null
id 7 completed   planned_start=null  planned_end=null
```

列表「开始/结束」列绑定的是 `actual_start/actual_end`（表头无"实际"字样）。

### F-05 取消

`POST /api/work_orders/4/cancel` → **404 接口不存在**（状态机 `cancel` 事件无入口）。

---

## 4. 整改记录（2026-11-05 当天完成）

### 4.1 P1

| 项 | 整改 | 验证 |
|---|---|---|
| **F-01** | `middleware/guards.js` 重写：统一 `ApiError.forbidden`（status=403）+ 正确中文文案；`app/workflow/workOrderDefinition.js` 状态机错误改中文 | 单测 WG.1 断言 403 与文案；实测已完成工单取消返回 `400 工单当前状态为「completed」，不能执行「取消」` |
| **F-02** | 新增 `onlyForemanAdminOrPlanner` 守卫（admin/foreman/planner），用于创建/派工/改工位/取消；`services/registry/mesa.js` 注入；`transit` 仍限主任/管理员 | 实测 planner 创建 200、取消 200；worker 仍 403 |
| **F-03** | 创建接口支持 `planned_end`/`priority`/`description` 并校验顺序；新增 `POST /api/work_orders/backfill-dates[?dryRun=1]`：有结束回推开始、有开始推算结束（两边都空留人工）；列表新增**计划开始/计划结束**列，原列改名实际开始/实际结束 | 单测 WG.2/WG.5；**生产已执行**：WO-2 补 `2026-06-14 00:02:35`、WO-3 补 `2026-06-09 16:03:28`；完全未排期 2 张保留并提示 |

### 4.2 P2

| 项 | 整改 | 验证 |
|---|---|---|
| **F-04** | 前端状态集合补齐 `dispatched/cancelled`，状态列/筛选/快捷筛选全中文 | 构建产物含「已派工/已取消」 |
| **F-05** | 新增 `POST /api/work_orders/:id/cancel`（状态机 cancel + 审计 + WS 事件）；前端行操作「取消」+ 二次确认 | 单测 WG.4；实测 pending→cancelled 200，completed→400 |
| **F-06** | 派工校验：状态必须 pending/dispatched、人员存在且在职、工位存在且启用、同人重复派工提示（`force=true` 越过）；改为**先校验后事务写库**（状态机 plan → 事务 UPDATE + allocation） | 单测 WG.3（状态/停用/停用工位/重复/force） |
| **F-07** | 报工校验负数工时/数量；响应返回 `over_reported` 与累计数量；报工失败提示中文 | 单测 WG.6 |
| **F-08** | 前端统一 `errorText()`（优先 `data.message`） | 派工/创建/取消/补齐失败均有具体原因 |
| **F-09** | 新增「新建工单」弹窗（项目/工单号/标题/工时/计划起止/优先级）；新增「详情」抽屉（计划/实际/派工/数量 + 操作流水）；列表操作列整理为 详情/齐套/流转/取消 | 构建通过；产物含「新建工单」「详情」 |

### 4.3 生产数据治理

| 项 | 结果 |
|---|---|
| 工单计划日期补齐 | 4 张中 2 张可推算 → 已补齐；2 张（WO-4、TEST-001）两端全空 → 保留人工排期，页面显示「另有 N 张完全未排期」 |
| 临时验证数据 | 审计验证用的临时工单（创建→派工→取消）已连同 allocation/operation/审计实例清理，生产工单数仍为 4 |

---

## 5. 测试与验证

| 项目 | 结果 |
|---|---|
| `tests/workOrderGovernance.test.js`（新） | **6/6**（守卫 403/文案、创建校验、派工校验+force、取消、补齐、报工） |
| 既有工单测试 | `workOrder` 4/4、`workOrderStateMachine` 10/10、`workOrdersStatusCheck` 6/6、`workOrderWorkstation` 4/4、`workOrderWorkflowAudit` 6/6 |
| demo / 全量闸门 | **745/0** |
| 前端 domain | 119/119；eslint 0、vue-tsc 0、build ok |
| 生产产物 | `WorkOrders-M2Dtdme3.js`（含「新建工单」「补齐计划日期」「完全未排期」） |

## 6. 现场实测（生产）

| 动作 | 结果 |
|---|---|
| planner 创建工单 | 200（原 403） |
| planner 派工 | 200；同人重复派工 → 400「该人员已在工单 TEST-001 上执行中」 |
| planner 取消 pending 工单 | 200 |
| 取消已完成工单 | 400「工单当前状态为「completed」，不能执行「取消」」 |
| 工单计划日期补齐 | dryRun 2 条 → apply updated=2 |

## 7. 未整改（P3 / 增强）

- **F-10 工单 ↔ 工序无关联**：`work_orders` 只有 milestone/subsystem，没有 `process_node_id`，工单工时/进度无法回挂项目排程；需要业务确认映射规则后加字段与回填。
- F-11 列表分页/排序、优先级中文标签（当前 1/2/3）。
- 工单附件/描述编辑、批量创建；工单与采购/库存联动（齐套已有）。
