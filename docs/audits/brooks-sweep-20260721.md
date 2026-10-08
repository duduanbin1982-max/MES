# Brooks-Lint - Full Sweep Report

**Mode:** Full Sweep
**Scope:** `192.168.1.73:/home/dubin/factory-mes` 全量 Git 跟踪文件；674 个文件，重点扫描 493 个生产 JS/TS/Vue 文件与 55 个测试文件
**Config:** `.brooks-lint.yaml` applied (1 risk disabled, 17 paths ignored)
**Health Score:** 89/100
**Trend:** Full Sweep 首次运行，无同模式历史趋势

系统当前没有阻断发布的 Critical 残余：源码可解析、依赖无环、结构闸门、422 项测试、前端类型检查与构建、生产依赖安全审计全部通过。本轮修复聚焦真实失败被吞、库存移动认知复杂度、私有长参数和已失效的测试缓存注入；剩余项均需要跨模块边界判断，不适合自动机械重构。

---

## Dimension Summary

| Dimension | Scanned | Safe Applied | Extended Applied | Reverted | Residual |
|-----------|---------|--------------|------------------|----------|----------|
| Review (R1-R6) | 493 production files | 12 | 2 | 0 | 1 |
| Test (T1-T6) | 55 test files | 0 | 2 | 0 | 0 |
| Debt | 548 source/test files | 4 | 2 | 0 | 1 |
| Audit | 493 production files | 1 | 1 | 0 | 2 |

说明：Dimension 的 Residual 会按不同维度重复命中同一结构问题；最终聚合后为 3 项。`T5` 由项目配置禁用，因此不产生覆盖率 finding。

## Iteration History

- Round 1: mixed；确认 27 个可操作或需保留的 finding。基线为 422/422 测试通过、548 条路由无重复、64 模块与 58 路由一致、50 服务 schema 指纹通过、层级边界通过。
- Round 2: mixed；完成库存移动、长参数、重复 SQL、静默失败和测试缓存注入修复。深嵌套 `30 -> 29`，长参数 `20 -> 18`，空 catch `30 -> 23`，`require.cache` 文件 `16 -> 14`。
- Round 3: clean；完成业务失败显式化和前端操作错误反馈。最终空 catch `23 -> 0`，无新增 AST、依赖、重复源码或测试回归。
- Stopped at: clean round；无 outstanding Critical，无 3-retry retired 项。

## Fix Log

| # | File | Lines | Risk | Outcome | Change |
|---|------|-------|------|---------|--------|
| 1 | `services/material/inventory.js` | 46+ | R1/R4 | applied | 将五类库存移动拆为独立处理器和统一库存 upsert，保留事务、状态与低库存推送语义。 |
| 2 | `services/setupWizardService.js` | 63+ | R1 | applied | `step` 私有构造器改为对象参数，消除 9 个位置参数。 |
| 3 | `services/masterDataService.js` | 62+ | R1 | applied | `issue` 私有构造器改为对象参数；重开 waiver 前显式检查表存在。 |
| 4 | `services/processHoursService.js` | 76 | R3 | applied | 删除查询中重复的 `operation_name` 字段。 |
| 5 | `services/feishuNotify.js` | 11+ | R3/R4 | applied | 统一飞书审计落盘入口，写盘失败改为可观测告警。 |
| 6 | `services/process/params.js`, `services/qc/inspectionRoutes.js`, `services/spcService.js` | parsing paths | R4 | applied | JSON 兼容降级改为显式 fallback，消除隐式空 catch。 |
| 7 | `services/spcMonitor.js` | 18+ | R4 | applied | 保留坏配置降级，同时记录单节点 SPC 分析失败。 |
| 8 | `app/ws/manager.js` | 145+ | R4 | applied | ping/terminate 失败时标记并移除失效客户端。 |
| 9 | `services/andonService.js` | 121+ | R4 | applied | 非法告警 JSON 显式返回 `data: null`。 |
| 10 | `services/delivery/dbContext.js` | 54+ | R4 | applied | 动态加列失败后复查 schema；非并发重复列错误不再被吞。 |
| 11 | `services/delivery/readModel/exceptions/supply.js` | 45 | R4 | applied | 主数据异常读取失败进入服务日志。 |
| 12 | `services/delivery/sourceSync.js` | 87+ | R6 | applied | MDM 异常关闭/重开失败不再返回假成功，错误进入统一异常链。 |
| 13 | `frontend/src/composables/useOeePage.ts`, `frontend/src/views/ProcessParams.vue` | load/render paths | R4 | applied | OEE、趋势和工艺参数图表失败提供明确反馈。 |
| 14 | `frontend/src/composables/useWebSocket.ts` | 83+ | R4 | applied | 隔离订阅者异常并记录坏消息，ping 监听对非 JSON 消息显式忽略。 |
| 15 | `frontend/src/views/Trace.vue`, `frontend/src/views/WorkOrders.vue` | data loaders | R4 | applied | 装备、追溯矩阵、人员和工位加载失败不再静默。 |
| 16 | `frontend/src/views/PlmDrawings.vue`, purchase composables | command handlers | R4 | applied | 区分用户取消与 API 失败，签发、审批、删除失败显示业务错误。 |
| 17 | material/purchase test harnesses | setup | T4 | applied | 删除对已不存在 `db` 模块的 `require.cache` 注入与广域缓存清理。 |

无修复被回滚；无 finding 达到 3 次失败退休条件。

## Health Score Delta

Before: 39/100 -> After: 89/100

按 Brooks 规则估算：修复前合并 finding 为 1 Critical、5 Warning、21 Suggestion；修复后仅保留 2 Warning、1 Suggestion。建议使用 `/brooks-health` 做独立精确复算。

## Verification

- `bash scripts/run-all-tests.sh`: 422/422 passed，0 failed，0 skipped。
- Route uniqueness: 548 literal routes passed。
- Module manifest: 64 modules / 58 router paths passed。
- Service schema: 50 services / 36 with DDL passed。
- Layer boundary: backend、service、frontend domain boundaries passed。
- `npm run typecheck`: passed。
- `npm run build`: Vite production build passed。
- Backend `npm audit --omit=dev`: 0 vulnerabilities。
- Frontend `npm audit --omit=dev`: 0 vulnerabilities。
- `git diff --check`: passed。
- AST parse errors: 0；dependency cycles: 0；exact duplicate production groups: 0；empty catch: 0。

## Residual Items (3 not applied)

### Warning - R1 Cognitive Overload: 少数编排器仍有高嵌套或较长闭包

Symptom: `frontend/src/composables/processTreePage/commands.js:onCmd` 嵌套深度 7；`services/scanner.js` 核心处理函数深度 6；`services/equipment/scheduler/scheduler.js:scheduleInstance` 为 92 行、深度 5。另有职责内聚但偏长的 OEE、ANDON 和 delivery read-model 控制器。

Source: Fowler - *Refactoring*, Long Method；McConnell - *Code Complete*, High-Quality Routines。

Consequence: 新增命令分支、扫码规则或排程约束时，局部改动需要理解更多状态组合，回归范围扩大。

Remedy: 在下一次真实业务变更时，按命令分派、输入归一化、约束计算和结果映射提取纯函数，并先补对应前端/调度定向测试。

Not applied because: `onCmd` 和 scanner 缺少足够直接测试，scheduler 属于核心排程算法；机械拆分的回归风险高于当前收益。

### Warning - R6 Domain Model Distortion: 两张核心表仍有多个写入所有者

Symptom: `shortage_cases` 由 BOM 风险、交付同步、采购跟催效果和缺料关闭 4 个模块直接写入；`process_nodes` 仍有 9 个写入模块。`project_cost_entries` 已收敛为单一写入口。

Source: Evans - *Domain-Driven Design*, Aggregate Root and Bounded Context；Ousterhout - *A Philosophy of Software Design*, Information Leakage。

Consequence: 状态审计、事务和 schema 规则可能随调用方分叉，后续字段变更需要跨多个模块同步验证。

Remedy: 建立 `ShortageCaseRepository` 与 `ProcessRouteRepository` 唯一写入口，跨模块流程调用领域用例并发布事件，读模型保持只读直查。

Not applied because: 需要跨服务迁移事务边界和公共调用契约，属于高风险架构改造。

### Suggestion - R4 Accidental Complexity: 18 个内部函数仍超过 4 个参数

Symptom: `projectLineage.addGap`、`andonService.triggerAlert`、`projectWorkflow.workflowBlocker` 各有 8 个参数；另有采购跟催、领料和工作流内部函数为 5-6 个参数。

Source: Martin - *Clean Code*, Function Arguments；Fowler - *Refactoring*, Introduce Parameter Object。

Consequence: 同类型字符串、ID 和状态参数易错位，调用点的业务意图不够直观。

Remedy: 当对应接口下一次发生变化时，将稳定字段组合收敛为领域参数对象，并为边界序列化增加测试。

Not applied because: 部分函数跨模块调用或接近公共服务边界，统一改签名会扩大本轮 blast radius。

## Summary

- Total findings detected: 27。
- Fixed this sweep: 24。
- Residual needing human-guided refactor: 3。
- Unresolvable after retry budget: 0。
- 远端改动保留为未提交工作树；本轮未 commit、未 push、未部署。
