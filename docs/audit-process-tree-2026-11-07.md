# 工艺树模块审计与修复报告

> 审计对象：工艺树（`/process-tree`）：BOM → 工序节点、层级树、依赖网络、关键路径、工序模板生成、质量/工时/工位/岗位配置、执行状态与前端树形视图  
> 审计日期：2026-11-07  
> 审计方式：代码走读（`services/processTree/**`、`services/process/**`、`services/processRouteService.js`、前端 `ProcessTree.vue` + `composables/processTreePage/**`）+ 生产 SQLite 全量数据完整性 SQL + API 实测 + Playwright 浏览器运行时/布局校验

## 0. 结论

**整改前评级：B** —— 树结构、节点 CRUD、依赖 CRUD、工序模板、工位/岗位、执行状态链路齐全，上一轮已修删除引用保护、父子环、布尔 500 等问题；但仍有 **2 个 P1 + 3 个 P2**：

- 关键路径只按父子层级计算，**完全忽略 89 条 `process_dependencies` 依赖**；
- 前端“从 BOM 生成”按钮调用的 `POST /process_tree/generate` **只读、不生成**，弹窗却提示“会清空工艺树”，实际点击无任何生成效果。

**整改后：A-（2 个 P1 + 3 个 P2 已修，P3 记录）**

| 编号 | 级别 | 问题 | 状态 |
|---|---|---|---|
| PT-1 | **P1** | 关键路径/CPM 只走 `parent_id` 父子边，忽略 `process_dependencies`（当前 89 条 FS 依赖），同级/跨部件依赖不影响 ES/LS/关键节点 | 已修 |
| PT-2 | **P1** | “从 BOM 生成”按钮实际调用只读快照接口，点击不生成任何节点，确认弹窗文案还声称会清空树 | 已修 |
| PT-3 | P2 | 实例 6 有 6 条工艺节点 `bom_node_id` 指向实例 2 的 BOM 节点（跨实例脏引用） | 已修（清零） |
| PT-4 | P2 | 自动生成工序使用硬编码 3 道工序，忽略 `process_operation_templates`：生成节点无模板 ID、QC/SOP/图纸要求、岗位、定员、标准工时 | 已修 |
| PT-5 | P2 | `process_standard_hours` 表 0 行，但路线完整性/标准人工时依赖该表；工序依赖 CRUD 无审计 | 已修 |
| PT-6 | P3 | `POST /process_tree/generate` 语义仍为只读；`process_standard_hours` 无唯一约束；超大工艺树接口无分页 | 记录 |

## 1. 数据基线

| 指标 | 数值 |
|---|---|
| 工艺节点 | **173**（实例1 159 / 实例2 7 / 实例6 7） |
| 根节点 | 31 / 7 / 7 |
| 工艺依赖 | **89**（全部 FS、lag=0） |
| 流程状态 | pending 83 / ready 82 / in_progress 4 / completed 4 |
| 工序模板 | 8 条（active） |
| 岗位 | 7 个 |
| 标准工时表 | 审计前 **0** → 修复后 **173** |
| 关键路径（实例1） | 修复前仅父子链；修复后 total **239h**、关键节点 **14**、依赖环 0 |

## 2. 发现与整改

### PT-1（P1）关键路径忽略工序依赖

`services/processTree/generator.js` 的 `topoSort/computeCPM` 只以 `parent_id` 建边，`getCriticalPath` 也只查 `process_nodes`；`process_dependencies`（89 条）虽然存在、依赖界面可维护，但**对 ES/LS/slack/关键路径没有任何影响**，且依赖环不会被 CPM 检出。

整改：
- `topoSort(nodes, dependencies)` 同时纳入父子边与依赖边，依赖环参与环检测；
- `computeCPM(nodes, dependencies)` 支持 **FS / SS / FF / SF** 四种依赖语义与 `lag_hours`：
  - FS：`successor.ES ≥ predecessor.EF + lag`
  - SS：`successor.ES ≥ predecessor.ES + lag`
  - FF：`successor.EF ≥ predecessor.EF + lag`
  - SF：`successor.EF ≥ predecessor.ES + lag`
- 反向遍历按依赖语义回推 LS/LF；`getCriticalPath` 查询本实例依赖并传入；
- 父子边保持原行为。

实测：实例1 关键路径 total_hours 239h、关键节点 14、cycle 0；新增单测验证 FS+lag、SS/FF/SF 和依赖环。

### PT-2（P1）“从 BOM 生成”按钮是空操作

前端 `commands.js` 的 `regenerate()` 调用 `processTreePageApi.regenerate()` → `POST /api/equipment_instances/:id/process_tree/generate`；该后端 handler 只做“读取节点 + 返回树 + 关键路径快照”，**不写库**。但 UI 确认弹窗写“重新生成会清空现有工艺树”，用户确认后实际什么都没发生。

整改（非破坏性）：
- “从 BOM 生成”按钮改为 **“从 BOM 补齐”**，确认文案改为“按 BOM 部件与工序模板补齐缺失工序（已存在节点保留，不会清空）”；
- 调用真实生成接口 `POST /api/process-route/instances/:id/generate-missing`；
- 按“部件 + 工序名”判断缺失，重复点击幂等；
- 保留 `POST /process_tree/generate` 作为只读树快照接口（P3 语义待统一）。

### PT-3（P2）跨实例 BOM 脏引用

生产数据发现实例 6 的 6 个工艺节点（ID 297~302）`bom_node_id` 指向实例 2 的 BOM 节点（76/77），属历史生成缺陷。运行时 CRUD 已校验 BOM 归属，但历史数据未清。

整改：迁移脚本 `scripts/migrate-process-tree-audit.js` 清零跨实例引用（本次清 6 条）；修复后 SQL 校验 `cross_bom = 0`。

### PT-4（P2）自动生成工序未使用工序模板

`processRouteService.generate-missing` 硬编码“装配准备/部件装配/过程检验”3 条模板，写死的工时/技能，未读取 `process_operation_templates`；生成节点没有：
`operation_template_id / qc_required / sop_required / drawing_required / required_position_code / worker_count`。

整改：
- 读取 active 工序模板（按 `sequence_hint, id`），按部件逐工序补齐缺失；
- 写入模板 ID、QC/SOP/图纸要求、岗位、定员、技能、标准工时；
- 无模板时回退默认 3 道工序（保持可用）；
- 同时插入 `process_standard_hours`（work_type/standard_hours/worker_count/unit/description）；
- 幂等：按 `bom_node_id + operation_name` 去重，重复调用不重复生成。

数据回填：50 个历史节点按名称匹配模板回填模板 ID/QC/SOP/定员/岗位/技能；173 条标准工时按 `estimated_hours` 回填。

### PT-5（P2）标准工时与依赖审计

- `process_standard_hours` 审计前 0 行；路线完整性/标准人工时（`components` 接口）依赖它，导致 `standard_man_hours` 全部为 0。整改后 173 行，实例1 标准人工时 **928h**（估算工时 768h，含定员系数）。
- 工序依赖 CRUD（POST/PUT/DELETE）原先无 `audit_logs`，补 `process_dependency.create/update/delete`（含 before/after、diff_summary）。

## 3. 验证

| 项目 | 结果 |
|---|---|
| 新增 `tests/processTreeAudit.test.js` | **4/4**（FS+lag、SS/FF/SF、依赖环、模板生成+标准工时+幂等） |
| 全量部署闸门 | **893/0** ✅（新增 4 例） |
| 前端 eslint / vue-tsc / build:safe | 0 / 0 / 通过（已部署 `frontend/dist`） |
| 生产 API | `/process_tree` 200（159 节点/89 依赖/31 根）、`/critical_path` 200（239h/14 关键节点/0 环）、`/process-route/.../components` 200（10 部件、标准人工时 928h）、`/process_dependencies` 200（89）、`/subsystems` 200（9+1） |
| 数据完整性 | 跨实例 BOM **0**、标准工时 **173**、模板节点 **50**、QC 39 / SOP 50；父子孤儿/跨实例/自环/负工时/未知岗位/依赖自环/重复/环 均为 0 |
| 浏览器运行 | Playwright：`/process-tree` pageerror 0、无“页面渲染失败”；选择 TBM-2026-001、展开 10 卡片，159 个节点行重叠 **0**；按钮文案“从 BOM 补齐” |

## 4. 剩余 P3（记录）

1. `POST /process_tree/generate` 仍是只读快照，接口名与实际语义不一致（前端已不用；建议改名 `/process_tree/snapshot` 或补齐生成语义）；
2. `process_standard_hours` 无 `process_node_id` 唯一约束，并发生成可能重复；建议加唯一索引；
3. 超大工艺树（>2000 节点）接口无分页/流式，`/process_tree` 会一次性加载全量节点与全局物料/工位映射；
4. CPM 依赖语义尚未回写到 `scheduled_start/end`（排程模块仍按自身逻辑），依赖 lag 仅影响关键路径展示；
5. 节点 `drawing_required` 生产模板当前均为 0，需工艺/质量确认是否应默认开启。

## 5. 改动文件

| 文件 | 说明 |
|---|---|
| `services/processTree/generator.js` | CPM 纳入依赖、FS/SS/FF/SF+lag、依赖环检测 |
| `services/processRouteService.js` | generate-missing 改为模板驱动 + 标准工时 + 幂等 |
| `services/process/node/dependencies.js` | 依赖 CRUD 补审计 |
| `frontend/src/composables/processTreePage/commands.js` | “从 BOM 补齐”调用真实生成接口、文案修正 |
| `frontend/src/views/ProcessTree.vue` | 按钮文案“从 BOM 补齐” |
| `scripts/migrate-process-tree-audit.js` | 跨实例 BOM 清理、模板/标准工时回填（幂等） |
| `tests/processTreeAudit.test.js` | 4 个审计回归测试 |
| `docs/audit-process-tree-2026-11-07.md` | 本报告 |

## 6. 复验方式

```bash
node --test tests/processTreeAudit.test.js
```

浏览器：`https://192.168.1.73/process-tree` → Ctrl+Shift+R：
1. 实例1 关键路径统计/关键节点高亮应体现依赖链（关键节点 14，总工期 239h）；
2. 点击“从 BOM 补齐” → 提示补齐数量；重复点击应为 0，不重复生成；
3. 展开各部件，节点行不重叠；QC/SOP 标记、标准工时、岗位/定员可在节点/路线完整性中看到；
4. 依赖新增/修改/删除后，审计日志可在 `/audit-logs` 查询到对应 `process_dependency.*`。
