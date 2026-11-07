# 工艺树模块升级改造报告（四阶段落地）

> 升级对象：工艺树 `/process-tree`（BOM → 工艺路线 → 执行 → 版本/变更 → 成本/KPI）  
> 日期：2026-11-07  
> 交付方式：后端服务 + 数据库迁移 + 前端工作台 + 回归测试 + 生产冒烟  
> 结论：**四个阶段的核心能力已落地并可用**；当前生产工艺树历史数据质量偏低（健康分 D），升级同时把历史问题显式暴露出来，后续按“模板细化 + 历史数据治理”继续收敛。

## 0. 交付摘要

| 阶段 | 交付内容 | 状态 |
|---|---|---|
| 第 1 阶段 | 部件级路线模板、全层级生成、路线健康度、依赖感知排程预览/回写 | ✅ 核心完成 |
| 第 2 阶段 | ITP 质量门禁、执行事件与状态机、暂停/恢复/返工/报工、扫码定位 | ✅ 核心完成 |
| 第 3 阶段 | 路线版本快照/发布、ECN 变更影响/审批、TBM 阶段、成本滚算、可视化工作台 | ✅ 核心完成 |
| 第 4 阶段 | KPI/瓶颈分析、完工预测、相似项目推荐 | ✅ 核心完成（启发式） |

新增 6 张表、5 个节点扩展列、20+ 路线升级 API、2 个前端组件（路线升级工作台/ITP 弹窗）；新增 4 个升级回归测试；全量部署闸门 **897/0**。

## 1. 第 1 阶段：路线标准化与排程约束

### 1.1 部件级路线模板

新增：
- `process_route_templates`：模板编码、名称、部件类别、材料类别、阶段、描述、启用状态；
- `process_route_template_steps`：工序序号、工序名/类型、阶段、标准工时、定员、工位类型、技能、岗位、QC/SOP/图纸要求、外协标识、依赖类型/lag、描述。

API：
- `GET/POST /api/process-route/templates`
- `GET/PUT /api/process-route/templates/:id`
- 支持一次提交模板 + 全部步骤；模板编码唯一、步骤至少 1 道、依赖类型 FS/SS/FF/SF 校验。

初始化：迁移时用现有 8 条工序模板自动生成 `TPL-GENERIC`（通用部件路线，8 步），后续可按部件类别细化。

### 1.2 全层级 BOM 生成

`POST /api/process-route/instances/:id/generate-from-template`

- 遍历该实例 **全部层级 BOM**（不再只 tier-1），按 `part_category`/`material_category` 匹配模板，匹配不到回退通用模板；
- 已存在“同部件 + 同工序名”跳过，幂等；
- 生成节点写入模板 ID、阶段、QC/SOP/图纸要求、岗位、定员、技能、外协标识；
- 同步生成 `process_standard_hours` 标准工时；
- 自动生成工序依赖（模板步骤间 FS/lag）；
- 生成节点自动分配 `node_code = PN-<id>`（扫码用）；
- 支持 `dry_run` 试算，返回将新增节点/工时，前端执行前二次确认。

**试算数据（实例1，未写库）**：68 个 BOM 节点、通用模板 8 步、计划新增 442 个工序节点 / 3326h。  
> 原因：现有 219 个历史节点工序名多为“装配准备/部件装配/过程检验”等，与通用模板 8 道标准工序不完全同名，因此“按模板补齐”会把差异工序补出来。正式批量应用前应先细化模板/确认历史节点，这是当前最大数据治理点。

### 1.3 路线健康度

`GET /api/process-route/instances/:id/health`

检查项：
- 空树、扁平树（全部根节点）、无模板、0 工时、无工位、无岗位、QC 工序未标记 QC、无计划日期、外协无成本、无标准工时、依赖环、悬空依赖、QC 节点无 ITP；
- 输出 0~100 分、A/B/C/D 等级、问题列表（error/warning/info）；前端工作台展示分数与问题清单。

**当前生产基线**：实例1 健康分 **D（0 分）**、**476 条问题**——这是历史工艺树缺少模板/工位/岗位/计划日期的真实反映；升级完成后可按问题清单逐项治理。

### 1.4 依赖感知排程

- `POST /api/process-route/instances/:id/schedule/preview`：按 `process_dependencies`（FS/SS/FF/SF + lag）与父子约束跑 CPM，计算最早开始/浮动，按工作日（默认 8h/日，跳过周末）给出计划日期；
- `POST /api/process-route/instances/:id/schedule/apply`：确认后回写节点 `planned_start/planned_end`，写审计。

实例1 预览：219 个节点、总工期 **239h**，预览/回写接口均 200。

## 2. 第 2 阶段：执行闭环与 ITP 质量门禁

### 2.1 执行事件与状态机

- 新增 `process_operation_events`：记录 start/resume/pause/complete/qc/block/rework/report/itp_check，含前/后状态、操作人、工时、数量、原因、扩展 JSON；
- `POST /api/process_nodes/:id/execute` 升级：
  - 状态门禁：start 仅 pending/ready/blocked；resume 仅 paused/blocked；complete/qc 仅 in_progress；
  - 完工/质检结果为 `fail` 时进入 blocked，不再错误标记 completed；
  - 新增 rework（回到 ready 并重置 ITP 复检）、report（报工事件）；
  - 全部动作写 `audit_logs` 与操作事件。

### 2.2 ITP 质量检验点

新增 `process_itp_points`：工序、点号、类型（self/witness/hold）、检验要求、状态（pending/passed/failed/waived）、检验人/时间/备注。

API：
- `GET /api/process_nodes/:id/itp`
- `POST /api/process_nodes/:id/itp/seed`（QC 工序开工自动生成“自检 + 停止点”，也可手动生成）
- `POST /api/process_itp_points/:id/check`
- `POST /api/process_nodes/:id/execute` 门禁：
  - **开工**：前置依赖未完成 → 400；hold 停止点未通过 → 400；
  - **完工**：ITP 点未全部 passed/waived → 400；QC 工序无 ITP 点 → 400。
- 前端节点“更多 → 检验点(ITP)”打开发放/不通过操作，完工前会被校验。

### 2.3 扫码定位

- `GET /api/process_nodes/by-code/:code`：按 `PN-xxxx` 返回节点；
- 所有历史节点与新建节点均回填唯一 `node_code`；后续扫码报工/移动端可直接按编码开工。

## 3. 第 3 阶段：版本/ECN、阶段、成本、可视化

### 3.1 路线版本

- 新增 `process_route_versions`（草稿/已发布/作废，快照 JSON、节点/依赖数、发布人、发布时间）；
- API：创建版本快照、列表、详情、发布；发布后旧版本自动作废，并把节点 `route_version_id` 指向新版本；
- 前端“版本与变更”页签可创建/发布。

### 3.2 ECN 变更单

- 新增 `process_route_changes`（变更号、标题、原因、状态、影响 JSON、申请/审批）；
- 创建变更单时自动对比“最近已发布版本”与当前树：新增/删除/字段变更/工时变化；
- 审批 `approved/rejected` 写审计；影响分析供工艺/生产/质量评估。
- 当前限制：审批通过后不会自动把变更应用到树（仍需手工调整后重新发布版本），避免误改。

### 3.3 TBM 阶段与成本

- `GET /api/process-route/instances/:id/phases`：按 `phase_code` 汇总节点/完成/工时；
- 新增/使用阶段编码（preparation/fabrication/inspection/assembly 等）；
- `GET /api/process-route/instances/:id/cost`：按标准工时 × 定员 × 工种费率、实际工时 × 费率、外协计划/实际成本滚算，按节点/实例汇总；
- 当前费率取 `labor_rate_cards`，无匹配工种回退 200 元/h。

### 3.4 可视化

新增 `ProcessRouteUpgradeDrawer.vue`（工艺路线升级工作台）：
- 总览：健康分、阶段进度、成本概览、工时效率、瓶颈工位；
- 依赖排程：日期/每日工时 → 预览 → 回写；
- 模板生成：选模板 → 试算 → 二次确认后补齐；
- 版本与变更：创建/发布版本、创建/审批 ECN。

## 4. 第 4 阶段：KPI、瓶颈与相似项目

`GET /api/process-route/instances/:id/kpi`：
- 节点完成率、进行中/卡住、标准/实际工时及偏差、返工次数、超期节点、按期完成率、剩余工时、预计完成天数、工位瓶颈 Top10。

`GET /api/process-route/instances/:id/similar`：
- 按 BOM 物料集合 Jaccard 相似度，推荐相似项目及其主要路线模板（当前实例1 有 1 个相似项目）。

预测为**启发式**：近 30 天完成/报工工时日均 → 剩余工时/日均；无历史时按 8h/日估算，不是机器学习模型。

## 5. 数据与验证

### 5.1 迁移

`scripts/migrate-process-route-upgrade.js --apply`：
- 新建 6 表：路线模板、模板步骤、版本、ECN、执行事件、ITP；
- `process_nodes` 增加：`route_version_id`、`route_template_id`、`is_external`、`rework_of_node_id`、`node_code`；
- 历史节点 `node_code = PN-<id>`；无模板时自动生成通用模板（8 步）。
- `processRouteService` schemaVersion 1→2，`process` 1→2。

### 5.2 当前生产数据快照

| 指标 | 数值 |
|---|---|
| 工艺节点 | 245（实例1 219 / 实例2 19 / 实例6 7） |
| 根节点 | 91 / 19 / 7 |
| 工艺依赖 | 89 |
| 路线模板 | 1 个通用模板（8 步） |
| 已经路线版本/ECN/执行事件/ITP | 0（新功能尚未在生产使用） |
| 健康分（实例1） | D / 0 分 / 476 条问题（历史数据治理项） |

### 5.3 自动验证

| 项目 | 结果 |
|---|---|
| 新增 `tests/processRouteUpgrade.test.js` | **4/4**：模板+全层级生成、健康度+排程、执行门禁、版本/ECN/阶段/成本/KPI/相似 |
| 全量部署闸门 | **897/0** ✅ |
| 前端 eslint / vue-tsc / build:safe | 0 / 0 / 通过（已部署 `frontend/dist`） |
| 生产 API 冒烟 | templates/health/kpi/phases/cost/versions/changes/similar 200；schedule/preview 200（219 行/239h）；generate 试算 200（442 节点/3326h） |
| Playwright | `/process-tree` 点击“路线升级”打开工作台，健康分/问题/阶段/成本/KPI 正常渲染，无 pageerror |

## 6. 已知边界（后续迭代）

1. **模板覆盖**：当前仅 1 个通用模板，无法精确匹配不同部件类别；试算 442 节点说明模板与历史节点命名差异大，正式批量应用前需细化模板/清洗历史节点；
2. **健康分**：当前 D/0 分是历史数据真实反映，需按问题清单治理（模板、工位、岗位、计划日期、ITP）；
3. **ECN 自动化**：审批通过不自动改树/生成新版本，仍是“人工调整 + 重新发布”；
4. **排程联动**：回写的是节点计划日期，尚未与 `Schedule` 模块的排程表/甘特图双向同步；
5. **ITP 前端**：当前按节点逐个维护，缺少批量生成/批量放行；扫码定位 API 已提供，移动端页面未接；
6. **成本/预测**：费率为简化模型，预测为日均工时启发式，非 ML；
7. **数据治理**：模板生成默认会补差异工序，需通过试算+确认控制；建议先对实例1 的 219 节点做“保留/作废/重生成”评审。

## 7. 复验方式

1. 后端已重启，迁移已执行；
2. 打开 `https://192.168.1.73/process-tree` → 选择实例1 → 点“路线升级”：
   - 总览看健康分/问题/阶段/成本/KPI；
   - “依赖排程”先预览，确认后再回写；
   - “模板生成”先试算，再决定是否补齐（会二次确认）；
   - “版本与变更”创建版本/ECN；
3. 节点“更多 → 检验点(ITP)”创建/放行检验点；QC 工序未放行时无法完工；
4. 审计日志可查 `process_route.*` / `process_itp.*` / `process_node.execute`。
