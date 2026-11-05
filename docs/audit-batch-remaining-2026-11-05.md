# 剩余模块批量审计报告（覆盖 51 个模块 / 36 个页面）

> 审计日期：2026-11-05  
> 方式：**广度优先自动审计**（模块清单 → 路由组件 → 递归抽取 API → 多角色探活 + 静态扫描 + 数据量核对），再对采购/物料/文档做重点深挖  
> 脚本：`scripts/audit-modules-sweep.js`（`npm run audit:modules`）  
> 报告产物：`logs/audit/remaining-modules-<ts>.{md,json}`、`logs/audit/remaining-modules-latest.json`

## 0. 结论

**批次覆盖结果：可用（探活 0 失败、菜单/接口权限 0 错配）**，深挖发现并修复 2 个真实问题（文档权限、文档上传孤儿文件）。

| 指标 | 结果 |
|---|---|
| 菜单模块总数 | 63（去重后 36 个页面路径） |
| 前序已审计模块 | 12（dashboard/gantt/multi-schedule/schedule/work-orders/instances/oee/quality 等） |
| 本批次覆盖模块 | **51 个**（映射到 36 个页面） |
| 接口探活 | **0 个失败**（全部 200/正常） |
| 菜单可见但接口 403 | **0 处**（修复文档权限后复核） |
| 后端疑似乱码文件 | 8 个 → **人工复核全部为误报**（`??` 空值合并/SQL 模板/注释） |
| 深挖修复 | 2 项：文档读权限、文档上传孤儿文件 |

## 1. 覆盖范围（51 个模块 → 36 个页面）

| 域 | 模块 | 页面 |
|---|---|---|
| 驾驶舱 | delivery, reports | `/delivery`、`/reports` |
| 项目 | project-wizard, tbm-advanced, acceptance | `/project-wizard`、`/tbm-advanced` |
| 设计 | bom, documents, eco, process-tree, process-master, process-params, spc-design | `/bom`、`/documents`、`/eco`、`/process-tree`、`/process-master`、`/process-params`、`/spc` |
| 执行 | process-hours, shopfloor, dispatch, scan | `/process-hours`、`/shopfloor`、`/work-orders`、`/scan` |
| 供应链 | materials, material-units, inventory, material-alerts, purchase-orders, suppliers, kit-closure, purchase-followup | `/materials`、`/material-alerts`、`/purchase`、`/kit-closure` |
| 质量/追溯 | trace, critical-parts | `/trace`、`/tbm-advanced` |
| 设备 | equipment-ledger, tpm, maintenance-plans, field-service, spares, digital-twin | `/equipment-ledger`、`/maintenance`、`/field-service`、`/digital-twin` |
| 成本/经营 | cost, cost-variance, price-variance, outsource-depreciation-cost, business-reports | `/cost`、`/cost-variance`、`/price-variance`、`/business-reports` |
| 异常/协同 | exceptions, andon, risk-todo, purchase-exceptions, quality-exceptions, mdm-exceptions | `/exceptions`、`/andon`、`/mdm` |
| 系统 | users, roles, role-groups, workstations, labor, coding-rules, settings, system-diagnostics, audit | `/users`、`/workstations`、`/labor`、`/settings`、`/audit` |

> `dispatch`/`acceptance` 与已审页面复用（`/work-orders`、`/tbm-advanced`），不重复审计。

## 2. 自动审计怎么做的

1. 从 `config/moduleManifest.json` 取模块 → `frontend/src/router` 映射组件；
2. 从组件递归解析相对 import（views → composables → 子组件，最多 3 层，跳过 `api/index` 聚合桶与 stores），抽取 `Api.get` 路径；
3. 用 **admin + planner/foreman/worker/qc/sales** 六种角色探活，记录状态码、耗时、数据条数；
4. 按 `menuCatalog` 的 `MODULE_PERMISSION / SECTION_PERMISSION` 判断"菜单可见但接口 403"的错配；
5. 静态扫描：疑似乱码文案、`new ApiError(4xx, ...)` 参数错位、写入路径 `toISOString`、TODO/FIXME；
6. 输出 Markdown（人看）+ JSON（机器看），失败项单列。

## 3. 重点深挖：采购 / 物料 / 文档

### 3.1 数据规模

| 表 | 条数 | 说明 |
|---|---|---|
| materials | 36 | 物料主数据 |
| inventory | 3 | 库存（偏少，需现场补） |
| material_lots | 19 | 批次 |
| material_movements | 5 | 出入库流水 |
| suppliers | 8 | 供应商 |
| purchase_orders | 6 | 采购单 |
| documents | 5 | 文档/图纸 |
| instance_bom | 83 | BOM 节点 |
| instance_eco | 2 | 设计变更 |

### 3.2 发现与整改

| 编号 | 级别 | 问题 | 整改 | 验证 |
|---|---|---|---|---|
| DOC-1 | **P2** | **文档/图纸权限口径不一致**：菜单/接口只认 `document:read`，而设计域按 `process:read` 开放；结果计划员、车间主任能看到设计域但**看不到图纸/文档**（`/api/documents` 403） | 接口读规则增加 `process:read`（`/documents`、`/documents/:id`、`/documents/stats`），菜单 `documents` 权限改为 `['document:read','process:read']`（OR） | 角色矩阵复核：admin/planner/foreman/engineer/worker/qc/sales **全部 200** |
| DOC-2 | **P2** | **文档上传先落盘后校验**：重复 hash、`bom_node_id`/`eco_id` 不存在时，文件已写入存储目录 → 孤儿文件（磁盘泄漏） | 调整顺序：先做重复/BOM/ECO 校验，通过后再 `fs.writeFileSync` | `documentService.test.js` + `documentIntegrity.test.js` **12/12** 通过 |
| DOC-3 | P3 | DB 插入失败（非校验类异常）仍可能留下刚写入的文件 | 未修（低概率）；建议后续在插入外层 try/catch 删除 | — |
| PUR-1 | P3 | 采购/供应商只对 `purchase:read`（计划员、销售）开放；车间主任/工程师看不到采购进度 | 未改（属业务口径，待确认是否需要只读开放） | 角色矩阵已记录 |
| MAT-1 | P3 | 库存仅 3 条、流水 5 条，入库/出库/盘点闭环数据不足 | 未改（数据治理，建议现场补） | — |
| SWEEP-1 | P3 | 静态扫描的"乱码"全为误报（`??` 空值合并、SQL 模板、注释） | 已人工逐条复核；脚本后续可加白名单 | 8 个候选文件人工核对为 0 真乱码 |

### 3.3 采购 / 物料 / 文档接口探活（节选）

```
/api/materials           admin 200 · planner 200 · foreman 200 · worker 403 · qc 200 · sales 403 · warehouse 200
/api/inventory           admin 200 · planner 200 · warehouse 200
/api/inventory/alerts    admin 200 · planner 200 · warehouse 200
/api/purchase_orders     admin 200 · planner 200 · 其它 403（菜单按 purchase:read 过滤）
/api/suppliers           admin 200 · planner 200 · 其它 403
/api/documents           admin 200 · all roles 200（整改后）
```

> materials 页面对 worker/sales 的 403 是预期：菜单权限为 `material:read`，这两类角色没有该权限，菜单也不可见。

## 4. 其他页面批量结论

- **36 个页面全部探活通过**（无 500、无 404、无超时）；
- **菜单权限与接口权限一致**（抽样 6 角色 × 每页 5~10 个接口）；
- 报表/交付/TBM 增强/工艺树/BOM/ECO/SPC/工时/车间/扫码/物料/预警/采购/齐套/追溯/设备台账/维护/现场服务/数字孪生/成本/异常/安灯/用户/工位/劳动力/设置/审计等页面均能正常返回数据；
- 各页面数据量差异较大（BOM 83、物料 36、文档 5、库存 3），**数据完整性建议随业务推进补齐**。

## 5. 局限与建议

1. 本批次是**广度优先**：验证了"页面能开、接口能通、权限不错配"，没有逐模块深挖业务流转（如采购收货入库、物料批次追溯、文档签发-签收闭环）；
2. 建议下一轮按业务链路做深挖（优先级）：
   - **采购**：采购单 → 审批 → 收货 → 入库 → 对账（6 条采购单可做全链路演练）；
   - **物料**：BOM 需求 → 领料 → 库存扣减 → 批次追溯；
   - **文档**：上传 → 签发 → 签收 → 版本升级 → 收回；
3. 自动审计脚本已入库（`npm run audit:modules`），可纳入每周巡检或与日检脚本串联。
