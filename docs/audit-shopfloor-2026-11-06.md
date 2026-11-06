# 车间工作台模块审计报告

> 审计对象：`/shopfloor`（车间工作台：扫码报工 / 领料退料 / 报工 / 现场质检 / 异常上报 / 文档签收）  
> 审计日期：2026-11-06  
> 审计方式：代码走读（前端 287 + composable 294 行；后端 `shopfloorService` 94 行 + `scanner` 133 行）+ 生产接口实测 + 多角色权限矩阵 + 现场作业闭环演练  
> 生产数据：工单 4 张（completed 2 / in_progress 1 / pending 1）、工序节点 170 个、异常/安灯 11 条

## 0. 结论摘要

**整改前评级：C+** —— 页面能用，但**现场核心动作对工人不可用**（扫码 403），且存在**操作人可伪造、已完成工单可重新开始**等数据安全/完整性问题。

**整改后：A-（3 个 P1 + 3 个 P2 已修）**

| 编号 | 级别 | 问题（整改前实测） | 状态 |
|---|---|---|---|
| SH-1 | **P1** | 扫码操作人直接信任 `body.operator_id`，任意用户可冒充他人（审计/追责失真） | 已修 |
| SH-2 | **P1** | 权限错配：`/scan/execute` 只认 `equipment:write`，**工人/焊工 403**（现场无法扫码）；worker 也缺 `pick:write`（无法领料） | 已修 |
| SH-3 | **P1** | 扫码动作无白名单、无状态机：已完成工单可再次 `start`/`complete`，任意 `action` 字符串可入库；工时/数量可负、可超计划 | 已修 |
| SH-4 | P2 | 工作台无数据范围：任何工人能看到全厂工单、异常与他人报工 | 已修（worker/welder 只看自己） |
| SH-5 | P2 | 今日报工/今日质检用 UTC 日期（`date('now')`），早 8 点前会算到前一天 | 已修（本地日期） |
| SH-6 | P2 | 前端报工写死 `worker_id: 1`，报工人永远是管理员 | 已修（取当前登录用户） |
| SH-7 | P3 | 扫码固定 1h/1 件；异常走上古手工入口；worker 无法现场自检；无断网补报 | **已全部修复**（扫码输入/安灯统一/shopfloor:qc/离线队列） |

## 1. 模块现状（走读）

```
车间工作台 /shopfloor
├─ 扫码：/api/scan/lookup、/api/scan/execute（工单/工序节点）
├─ 领料/退料：/work_orders/:id/pick-list|pick-history|pick|return
├─ 报工：/work-reports（待审批，2026-11-06 已接审批流）
├─ 现场质检：/qc_inspections
├─ 异常上报：/exceptions/shopfloor_manual/action
├─ 文档签收：/documents/:id/acknowledge
└─ 工作台汇总：/api/shopfloor/overview（工单/待签收文档/异常/最近报工/质检）
```

## 2. 发现与整改明细

### SH-1（P1）操作人可伪造

`scanExecute` 直接把 `body.operator_id` 写进 `work_order_operations` / `process_executions`。

整改：默认取登录用户（`req.user.uid`）；只有持有 `work_order:write` 或 `equipment:write` 的主管可代操作，否则 403。
实测：worker 传 `operator_id=1` → **403 "不能代替他人扫码操作"**；正常扫码 `operator_id=4`。

### SH-2（P1）权限错配：工人无法扫码/领料

`/scan/execute` 路由守卫为 `requirePermission('equipment:write')`，worker/welder 均无此权限 → 现场扫码直接 403。worker 也缺 `pick:write`，领料同样 403。

整改：
- 新增权限 `shopfloor:write`，扫码守卫改为 `equipment:write OR shopfloor:write OR work_order:write`；
- worker / welder 补 `shopfloor:write` + `pick:write`；foreman / qc 补 `shopfloor:write`（存量角色用迁移脚本补齐）；
- 现场质检仍要求 `quality:write`（焊工具备、工人不具备）→ 前端按权限隐藏「质检」按钮，避免点开 403。

实测：worker 扫码 200、领料接口通过权限校验（空清单返回业务 400）、质检 403（按钮已隐藏）。

### SH-3（P1）扫码无动作白名单/状态机/数量校验

原实现允许：
- `action: 'hack'` 直接入库；
- 对 `completed` 工单再次 `start`（会把已完成工单改回 in_progress）；
- `hours_worked: -5`、`quantity_completed: -2`；
- 完成数量超计划也照单全收。

整改（`services/scanner.js` 重写）：
- 动作白名单：工单 `start/pause/complete/block`；工序 `start/pause/complete/qc/block`；
- 状态机：终态（completed/closed/cancelled）禁止任何动作；start 仅允许 pending/dispatched/paused；complete/pause 仅 in_progress 等；
- 工时 `0 < h ≤ 24`；数量/不良数 ≥ 0 且为整数；完成数量不得超计划；
- 工单完成必须填完成数量；
- 质检动作必须给 `result=pass/fail`，**质检不合格不再置 completed**（保持 in_progress 等返工）；
- 状态校验放在事务内用最新数据，避免并发绕过。

实测：重复 start 400、终态 start 400、`action=hack` 400、负工时 400、冒充操作人 403。

### SH-4（P2）工作台数据范围

原 `overview` 返回全厂工单、最近报工与工时汇总。整改：`worker`/`welder` 角色 `scope=self`——只看 `assigned_to=自己或未分配` 的工单、只看自己的报工与今日工时；主管/管理员 `scope=all`。响应新增 `scope` 与 `user` 字段。

实测：worker 只看到 2 张本人/未分配工单、今日工时仅本人；admin `scope=all`。

### SH-5（P2）UTC 日期

`today_reports` / `today_qc_fail` 原用 `date('now')`（UTC）。整改为 `date('now','localtime')`，与页面展示的本地日期一致。

### SH-6（P2）报工写死 worker_id=1

前端 `submitReport` 固定 `worker_id: 1`。整改：取当前登录用户 id，提示文案改为"报工已提交，待审批（审批通过后计入工时与成本）"。
实测：worker 报工落库 `worker_id=4, status=pending`。

### SH-7（P3）四项全部整改（2026-11-06 第二轮）

**1. 扫码按实际数量/工时填报**

扫码结果区新增「数量 / 工时(h) / 不良数 / 质检结果」输入（质检结果仅在工序节点场景显示），并新增「质检」动作按钮；提交时携带实际值，后端 `scanner.js` 校验 `0<h≤24`、数量为整数且完成不超计划。
实测：扫码 start 传 `hours_worked=0.5, quantity_completed=1` → 落库一致。

**2. 异常上报统一到安灯（andon）**

前端 `raiseException` 由 `exceptions/shopfloor_manual/action` 改为 `POST /api/andon/trigger`（`alert_type=shopfloor_manual`、`source_type=shopfloor`、附带工单号/工位），后端记录 `triggered_by=登录用户`；工作台 overview 新增最近 10 条未关闭安灯（`summary.open_andon_alerts` + `andon_alerts`），异常页签直接展示安灯列表。
权限：新增 `exact("/andon/trigger", ["POST"], ["shopfloor:write","work_order:write"])`，且该规则置于通用 `/andon` 规则之前（实测修复前 worker 403，修复后 201）。
实测：worker 上报 → `201 {alert_id:12, triggered_by:4}`，落库 `triggered_by='4'`。

**3. 现场自检（shopfloor:qc）**

新增权限 `shopfloor:qc`（不授予质检管理权限），授予 worker / welder；`/qc_inspections` 写权限改为 `quality:write OR shopfloor:qc`；前端 `canQc` 按任一权限显示入口。
实测：worker 现场自检 → `200 {id:12}`（此前 403）。

**4. 断网离线补报**

新增 `frontend/src/domain/offlineQueue.ts`（纯函数）：队列上限 200 条、最大重试 5 次、`408/425/429/5xx` 与网络错误才入队（4xx 业务/权限错误不入队），localStorage 持久化、容错解析。
工作台接入：扫码 / 报工 / 安灯提交失败自动入队并提示；顶部离线横幅展示待补报数量与「立即补报」；`online` 事件自动重放（每批 5 条），补报成功后刷新工单/安灯。
前端 domain 用例 6/6 覆盖入队/出队/上限/重试/批次/判定/脏数据容错。

## 3. 验证

| 项目 | 结果 |
|---|---|
| `tests/shopfloorGovernance.test.js` | **6/6**（动作白名单/状态机/操作人/数量校验/扫码闭环/数据范围） |
| `frontend/tests/domain/offlineQueue.test.ts`（新） | **6/6**（入队/出队/上限/重试/批次/判定/容错） |
| 前端 eslint / vue-tsc / build | 0 / 0 / 通过 |
| 全量部署闸门 | **801/0** |
| 生产权限迁移 | 4 个角色补齐 `shopfloor:write / pick:write`（续跑幂等） |
| 生产现场演练 | 见下表 |

现场演练（真实 API）：

```
worker 工作台 → 200，scope=self，只 2 张本人/未分配工单，今日工时仅本人；admin scope=all
worker 扫码 start → 200（operator_id=4，status_after=in_progress）
重复 start → 400；已完成工单 start → 400；action=hack → 400；负工时 → 400
冒充操作人（operator_id=1）→ 403
worker 领料 → 通过权限（空 items 业务 400）；worker 质检 → 403（入口已隐藏）
worker 报工 → 200，worker_id=4，status=pending
演练数据已清理（工单状态/数量/执行记录恢复）

P3 演练（第二轮）：
worker 上报安灯 → 201（triggered_by=4，落库正确）；worker 现场自检 → 200；
扫码上报 0.5h/1 件 → 执行记录一致；工作台返回 scope=self 与 10 条安灯；
离线队列 domain 用例 6/6（浏览器断网场景需现场用手机飞行模式复核）
```

## 4. 改动文件

| 文件 | 说明 |
|---|---|
| `services/scanner.js` | 重写：动作白名单/状态机/操作人/数量校验/QC 结果 |
| `services/shopfloorService.js` | 数据范围、本地日期、scope 输出 |
| `routes/instance/operations.js` | 扫码权限改为 equipment/shopfloor/work_order 任一 |
| `app/permissions.js` | 新增 `shopfloor:write` + 角色默认权限 |
| `scripts/migrate-shopfloor-permissions.js` | 存量角色补权限（幂等） |
| `frontend/src/composables/useShopfloorWorkspacePage.ts` | 当前用户报工、canQc/canPick |
| `frontend/src/views/ShopfloorWorkspace.vue` | 质检/领料按钮按权限显示 |
| `tests/shopfloorGovernance.test.js` | 6 个回归用例 |
| `frontend/src/domain/offlineQueue.ts` + `frontend/tests/domain/offlineQueue.test.ts` | 离线待补报队列（纯函数）+ 6 个单测 |

## 5. 复验方式

```bash
node --test tests/shopfloorGovernance.test.js
node --test frontend/tests/domain/offlineQueue.test.ts
node scripts/migrate-shopfloor-permissions.js --apply   # 幂等（含 shopfloor:qc）
```

前端：`/shopfloor` → 用工号账号（worker）：扫码开始/完成、领料、报工；看不到「质检」按钮；管理员/主任：可见全部工单与质检入口。
