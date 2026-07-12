# Architecture Decision Records (ADR)

MES 系统的架构决策记录。每个决策一个章节。

---

## ADR-001: projects 表与 equipment_instances 表的数据冗余 (P0-3 brooks-lint R6)

**日期**: 2026-07-11
**状态**: Accepted (with Deprecation plan)
**决策者**: brooks-lint R6 audit

### 背景

`projects` 表 (3 行数据) 和 `equipment_instances` 表 (3 行数据) 存储了同一份业务实体：
- 客户名 (`customer_name`)
- 合同号 (`contract_no`)
- 计划起止 (`planned_start` / `planned_end`)
- 状态 (`status`)
- 合同金额 (`contract_amount`)

**历史**: Phase 1 早期 (2026-06-18) 创建了 `projects` 表，表达了"项目"概念。
**演进**: 后续 (2026-06-30) 新建了 `equipment_instances` 表，开始表达"盾构机实例"，无意中把项目数据也写进去了。
**现状**: 两个表并存，数据冗余。

### 决策

**保留 projects 表，但仅作为历史快照**。`equipment_instances` 是当前唯一的真实来源。

### 影响

- **代码**:
  - `seed-demo.js` 写入 projects（保留，作为 demo 数据）
  - `projectMasterService.js` 读 projects count（保留，UI 显示历史数）
  - `tests/projectMaster.test.js` 测 projects（保留）
- **数据**:
  - 新业务数据只写 `equipment_instances`
  - `projects` 表不再增长，但保留 3 条历史记录
- **文档**:
  - 本 ADR 作为权威说明
  - README.md 增加 "历史遗留" 章节

### 何时重新评估

- 当 4+ 个新文件不再读 projects 表
- 当 business logic 完全迁移到 equipment_instances
- 计划: **Phase 2 (Phase 1 正式投产 6 个月后)** 重新评估是否 DROP projects

### 拒绝的替代方案

| 方案 | 原因拒绝 |
|---|---|
| 立即 DROP projects | 破坏 4 个文件 + 测试，回归风险高 |
| 迁移 projects → equipment_instances | 数据已冗余，迁移只增加复杂度 |
| 加 `view` 兼容层 | SQLite VIEW 性能差 + 增维护成本 |

### brooks-lint 引用

- **R6 Domain Model Distortion**: Domain language mismatch
- **Hunt & Thomas — The Pragmatic Programmer**: "Don't Live with Broken Windows" — 但也要看修复成本
- **Fowler — Refactoring**: "Rule of Three" — 重复 3 次才抽象; 重复 1 次可以先记下

---

## ADR-002: webhook URL 验证统一到 services/webhookValidator.js (P0-1)

**日期**: 2026-07-11
**状态**: Accepted (Implemented)

### 决策

所有 webhook URL 构造/校验/发送统一到 `services/webhookValidator.js`:
- `buildWebhookUrl(rawToken, options)` — 平台模板化构造
- `validateWebhookUrl(url)` — 异步校验
- `validateWebhookUrlSync(url)` — 同步校验
- `sendWebhook(url, payload, options)` — 统一发送

### 影响

- 删除 3 处散落的 `new URL()` + 协议检查
- 3 个调用点改成 `buildWebhookUrl() + sendWebhook()`
- 平台协议变更 (飞书/钉钉) 是 1 行 PR

### 拒绝的替代方案

| 方案 | 原因拒绝 |
|---|---|
| 保留 4 处散落 | R3 Knowledge Duplication 持续 |
| 抽更细的 per-service wrapper | 增加调用栈深度，复杂度不减 |
| 用成熟库 (got / axios) | 增加 dep，且 webhook 是 fire-and-forget 不是 REST |


---

## ADR-003: app/oee, app/spc, app/workflow/ 标记为 @deprecated (P1-2 brooks-lint R4)

**日期**: 2026-07-11
**状态**: Accepted (代码保留, 标记废弃)
**决策者**: brooks-lint R4 audit

### 背景

`app/oee/engine.js` (198 行), `app/spc/engine.js`, `app/workflow/engine.js` (129 行), `app/workflow/definitions.js` (95 行), `services/oeeService.js` (21 行) —— **5 个文件 0 外部 require** (排除 backups/)。

这是 d764aea "TBM-MES production baseline" 重构时建的"业务引擎层", 计划是注册到 register-all.js, **但实际没注册**。业务跑在 `services/oee/`, `services/spcService.js`, `services/workflowService.js`。

### 决策

**保留 5 个文件, 加 @deprecated 头注释**, 不删除。

### 理由

- **删除风险高**: 没人能 100% 确定没有 indirect import (SPA 静态打包 / 配置文件)
- **保留信息价值**: 这是 d764aea 重构的"快照", 未来如果想"复活 OEE 业务到 app/", 这是起点
- **@deprecated 是最安全信号**: 编译/lint 工具可识别, IDE 会划线, 后续自然淘汰

### 影响

- 每个文件头加 6-7 行 @deprecated 块
- 不改任何 import / require
- 不影响运行时 (0 引用, 删不删都不影响)
- 未来 Phase 2 cleanup 时, grep `@deprecated` 找候选

### 拒绝的替代方案

| 方案 | 原因拒绝 |
|---|---|
| 立即删除 | 不能 100% 验证 0 间接引用 |
| 改名 (前缀 _) | 文件已经以 _migration.js 命名, 模式不一致 |
| 移到 archive/ | file 改名会破坏 git blame, 不必要 |


---

## ADR-004: db migrations 入口统一到 scripts/migrate.sh (R1 验证)

**日期**: 2026-07-11
**状态**: Verified (already implemented)
**验证者**: brooks-lint R1 重审计

### 背景

brooks-lint 之前审计 (R1) 提出"db migrations 入口分散在 scripts/migrate.sh + scripts/migrate-schema-review.sql + db/migrations/ 三处, 易漏跑"。

### 验证

**当前实况** (`/home/dubin/factory-mes/db/migrations/`)：
- 24 个迁移文件: 002_phase1.sql / 003_equipment_centric.sql / ... (按数字顺序)
- 1 个废弃: 001_phase1.sql.废弃
- 全部跑过, `schema_migrations` 表跟踪

**入口** (`/home/dubin/factory-mes/scripts/migrate.sh`)：
- 自动按文件名排序跑 db/migrations/*.sql
- 跳过 `.sql.废弃` / `.sql.bak` / 非主分支
- schema_migrations 表幂等去重

**唯一遗留 ad-hoc**：`scripts/migrate-schema-review.sql` — 一次性 P1-1 schema 审查脚本, 已跑过, 保留供复盘。

### 决策

**不改动**, R1 finding 已通过架构本身解决。

### 影响

- 已修复, 无新动作
- 未来新 schema 变更: `git add db/migrations/NNN_xxx.sql` + 跑 `scripts/migrate.sh` —— 1 行命令注册

### 验证步骤

```bash
ssh dubin@192.168.1.73 'bash scripts/migrate.sh --status'
# 应该列出全部已跑过的 migration
```
