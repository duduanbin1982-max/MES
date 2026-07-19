# Brooks-Lint Review

**Mode:** Tech Debt Assessment
**Scope:** 192.168.1.73:/home/dubin/factory-mes 全量活动源码（483 个 JS/TS/Vue/Shell 文件，65,559 行；排除依赖、构建产物、archive、backups、日志和临时目录）
**Config:** .brooks-lint.yaml applied (1 risks disabled, 17 paths ignored)
**Health Score:** 30/100
**Trend:** 39 -> 30 (-9) over last 2 runs

后端测试和装配边界已经明显改善，但远端未提交变更、前端契约失真和重新增长的长模块，已经成为下一阶段功能开发的主要阻力。

验证基线：后端 383/383 测试通过；548 条字面路由无重复；64 个模块与 58 条前端路由一致；前端生产构建通过；根依赖 0 漏洞；依赖图未发现可信循环。

---

## Findings

### Critical

**Change Propagation (R2) - 当前生产代码没有可复现的版本基线**

Symptom: `main` 停在 `a63e91a`，但远端存在 90 个已跟踪文件改动、47 个未跟踪入口；已跟踪差异为 7,090 行新增/5,487 行删除，未跟踪源码共 128 个文件、20,851 行。当前运行版本无法从任一提交准确重建。

Source: *Software Engineering at Google* - Code sustainability

Consequence: 回滚、迁移、合并和故障恢复都依赖当前服务器磁盘；任何后续修复都可能与既有改动交叉覆盖，代码审查也无法区分业务增量和历史遗留。

Remedy: 先按“基础设施/后端业务/前端页面/测试与文档”拆成可审查提交，打生产基线标签；把 `.codex-backups/` 纳入忽略规则；以后只从已提交且通过 CI 的提交部署。

Priority: 9 (Pain 3 x Spread 3) · [accidental]

**Domain Model Distortion (R6) - 前后端契约退化为 `any`，且已出现真实字段漂移**

Symptom: `/home/dubin/factory-mes/frontend/src/api/index.ts:11` 将兼容门面声明为 `any`，前端共有 1,182 个显式 `any`；严格类型检查产生 381 个错误、影响 30 个文件。后端 `/home/dubin/factory-mes/services/kitCheck.js:51` 返回 `short_items`，而 `/home/dubin/factory-mes/frontend/src/views/WorkOrders.vue:112` 读取 `missing_items`，缺料项会显示为空或错误。

Source: *Domain-Driven Design* - Ubiquitous Language / Bounded Context; *A Philosophy of Software Design* - Information Leakage

Consequence: API 字段、状态和空值规则只能靠开发者记忆；后端调整容易在前端静默失效，历史上的 404/500 和页面字段异常会继续重复出现。

Remedy: 先修复 `short_items` 契约；为齐套、工单、BOM、交付、质量建立共享 DTO/Schema，在 `api/*` 使用泛型返回类型；逐模块移除 `Api: any`，把 `vue-tsc --noEmit` 设为 CI 必过门禁。

Priority: 9 (Pain 3 x Spread 3) · [accidental；兼容门面虽属有意迁移，但没有退出计划]

**Cognitive Overload (R1) - 核心模块再次形成多职责热点**

Symptom: 活动生产代码中有 51 个文件超过 300 行、25 个超过 400 行。`/home/dubin/factory-mes/services/processMasterService.js:250` 的 `register()` 跨 232 行，同时承担迁移、岗位 CRUD、工序 CRUD、模板应用、资质校验和文档绑定；`/home/dubin/factory-mes/services/pickService.js:384` 的退料事务跨 64 行，`register()` 又跨 88 行；`/home/dubin/factory-mes/frontend/src/views/DeliveryDashboard.vue:1` 为 674 行并内含 3 个抽屉及多组风险/链路视图。

Source: *Refactoring* - Long Method / Divergent Change; *Code Complete* - High-Quality Routines

Consequence: 修改工序库、领退料或项目交付看板时，需要同时理解数据库、规则、HTTP 和 UI 状态，局部需求会扩大成高回归风险改动。

Remedy: 优先把 `processMasterService` 拆为 `schema/store/domain/routes`；把 `pickService` 拆为 `queries/transactions/routes`；把交付看板的 workflow、risk、lineage 抽成组件与 composable。每拆一层先保留现有行为测试。

Priority: 9 (Pain 3 x Spread 3) · [accidental]

### Warning

**Change Propagation (R2) - CI 测试清单靠手工维护并已漏项**

Symptom: `/home/dubin/factory-mes/scripts/run-all-tests.sh:54` 手工列出 44 个测试，但仓库实际有 46 个 `*.test.js`，漏跑 `pickService.test.js` 和 `processNodeSubsystem.test.js`；两者手工执行均通过。`/home/dubin/factory-mes/.github/workflows/test.yml:27` 只安装根依赖并跑后端，未安装/构建/类型检查前端，前端也没有任何自动化测试文件。

Source: *How Google Tests Software* - Change coverage; *Working Effectively with Legacy Code* - Characterization Tests

Consequence: 新增测试不会自动进入门禁，领退料等关键闭环可能在“全量测试通过”的假象下回归；前端路由、权限、表单和 API 契约完全依赖人工验收。

Remedy: 用文件发现自动执行 `tests/**/*.test.js`，仅对特殊环境测试声明显式配置；CI 增加 `frontend npm ci + build + vue-tsc`，再为登录、菜单、工单、BOM、质检、领退料补最小组件/E2E 冒烟网。

Priority: 6 (Pain 2 x Spread 3) · [accidental]

**Knowledge Duplication (R3) - 模块目录不是单一事实源**

Symptom: 模块的 key/title/path/icon/permission 分别维护在 `/home/dubin/factory-mes/config/moduleManifest.json:1`、`/home/dubin/factory-mes/frontend/src/config/menuCatalog.ts:19`、`/home/dubin/factory-mes/frontend/src/router/index.ts:4` 和 `/home/dubin/factory-mes/middleware/apiPermissions.js:27`。`check-module-manifest.js` 仅用正则比对前三者的部分字段，API 权限不在校验范围。

Source: *The Pragmatic Programmer* - DRY; *A Philosophy of Software Design* - Information Leakage

Consequence: 新增或改名一个功能仍需协调 4 个位置；当前检查可以通过，但菜单可见性、路由守卫和后端权限仍可能互相漂移。

Remedy: 让 `moduleManifest.json` 成为唯一声明，构建时生成菜单和路由元数据；权限规则改为路由注册时声明或由 manifest 引用，检查脚本改用结构化解析并覆盖权限。

Priority: 6 (Pain 2 x Spread 3) · [accidental]

**Knowledge Duplication (R3) - 状态词典仍需前后端人工同步**

Symptom: `/home/dubin/factory-mes/app/domain/statusCatalog.js:5` 与 `/home/dubin/factory-mes/frontend/src/domain/statusCatalog.ts:4` 重复维护采购、缺料和装备生命周期；前端额外存在 `S1`，标签与颜色元数据也只在前端扩展。`completed/pending/closed/open/cancelled` 仍散落在 30-50 多个文件中。

Source: *The Pragmatic Programmer* - DRY; *Domain-Driven Design* - Ubiquitous Language

Consequence: 同一状态在采购、缺料、装备和 UI 中可能出现不同终态判断、颜色或文案，闭环/反闭环逻辑需要多点同步修改。

Remedy: 用 `shared/statusVocabulary.json` 或只读元数据端点生成前端词典；按 bounded context 分离枚举，所有跨上下文转换集中放在明确的 mapper 中，并为终态映射加契约测试。

Priority: 4 (Pain 2 x Spread 2) · [accidental]

**Accidental Complexity (R4) - 数据库迁移存在两套并行机制**

Symptom: 仓库已有 `/home/dubin/factory-mes/migrate.js:6` 和 24 个版本化迁移文件，但仍有 31 个服务文件在运行时执行 `CREATE TABLE IF NOT EXISTS`；例如 `/home/dubin/factory-mes/services/processMasterService.js:251` 在服务注册时直接运行迁移。

Source: *A Philosophy of Software Design* - Tactical Programming Debt; *The Mythical Man-Month* - Conceptual Integrity

Consequence: Schema 所有权和执行顺序分散，启动服务带有隐式写库副作用；新环境、回滚、审计和并发启动很难证明数据库处于同一版本。

Remedy: 把 31 处 DDL 逐批迁移到 `db/migrations`，服务启动只做版本/列存在性校验；建立 migration ownership、向前/回滚测试和生产前备份门禁。

Priority: 6 (Pain 2 x Spread 3) · [accidental]

**Dependency Disorder (R5) - 前端存在未使用且有漏洞的依赖**

Symptom: 前端 `npm audit` 报 3 个漏洞：`xlsx` 1 个 high 且无修复版本，`echarts/vue-echarts` 2 个 moderate 且修复需要大版本升级。源码没有 `xlsx`、`vue-echarts`、`jspdf`、`jspdf-autotable` 的导入，图表页面直接导入 `echarts`；根依赖无漏洞，但 Express、better-sqlite3、Helmet 有待评估的大版本升级。

Source: *Software Engineering at Google* - Dependency Management / Upgrade Blockage

Consequence: 未使用包仍扩大供应链攻击面和安装成本；ECharts 升级被拖到大版本后，未来安全修复会与业务回归绑在一起。

Remedy: 先删除确认未使用的 `xlsx/vue-echarts/jspdf/jspdf-autotable`；为 7 个 ECharts 使用点补图表冒烟测试后升级 ECharts 6；根依赖大版本按独立分支逐项验证。

Priority: 4 (Pain 2 x Spread 2) · [accidental]

---

## Debt Summary

| Risk | Findings | Avg Priority | Classification | Intent |
|------|----------|-------------|----------------|--------|
| Cognitive Overload | 1 | 9.0 | Critical | accidental |
| Change Propagation | 2 | 7.5 | Critical | accidental |
| Knowledge Duplication | 2 | 5.0 | Scheduled | accidental |
| Accidental Complexity | 1 | 6.0 | Scheduled | accidental |
| Dependency Disorder | 1 | 4.0 | Scheduled | accidental |
| Domain Model Distortion | 1 | 9.0 | Critical | accidental |

**Recommended focus:** 先建立可复现提交基线，再修复前端契约/类型门禁，随后拆 `processMasterService`、`pickService` 和 `DeliveryDashboard`；这三步完成前不宜继续横向扩展新模块。

## Summary

当前系统的后端基础比上轮更稳：383 项测试全绿、路由和模块一致性检查有效、根依赖无漏洞，也没有发现可信依赖环。分数下降主要不是后端功能倒退，而是大量未提交代码扩大了不可追溯范围，同时 TypeScript 严格检查揭示了前端长期被构建流程掩盖的契约债；第一优先级应是“固化基线 + 类型化核心 API + 补齐 CI 门禁”。
