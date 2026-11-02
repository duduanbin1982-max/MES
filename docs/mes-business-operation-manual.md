# TBM-MES 操作手册

> 适用系统：`https://192.168.1.73`  
> 文档性质：面向业务用户的操作手册（重制版），与系统实际功能一一对应  
> 更新日期：2026-10-31  
> 配套文件：`docs/business-flow-sop.md`（单项目全流程 SOP）、`docs/training-drill-12steps.md`（12 步演练脚本）、`docs/backfill.md`（数据补录）、`docs/oee-backfill-guide.md`（OEE 补录）、`docs/mcp.md`（MCP 工具）、`docs/ops-hardening.md`（运维硬化）

## 1. 系统概述

TBM-MES 是围绕 **TBM / 非标装备项目交付** 建立的业务闭环系统，主线：

```text
用户/权限 → 主数据 → 装备实例 → BOM → 图纸/文档 → 工艺路线
→ 工单/排程 → 齐套/采购/领料 → 车间报工 → 质检/追溯
→ 成本归集 → 客户验收 → 追溯/售后/维保
```

左侧菜单按业务域归类：

| 一级菜单 | 解决的问题 | 核心入口 |
|---|---|---|
| 首页驾驶舱 | 管理层一屏看交付、风险、OEE、**全流程健康检查**、报表 | `/dashboard`, `/delivery`, `/reports`, `/oee` |
| 项目与装备 | 这台 TBM 到哪一步了 | `/instances`, `/schedule`, `/gantt`, `/tbm-advanced`, `/project-wizard` |
| 设计与BOM | 工程数据、BOM、图纸、ECO、工艺 | `/bom`, `/documents`, `/eco`, `/process-tree`, `/process-params` |
| 生产执行 | 工单、派工、报工、车间扫码、工位负荷 | `/work-orders`, `/process-hours`, `/shopfloor`, `/scan`, `/multi-schedule` |
| 采购与库存 | 物料主数据、库存、采购、齐套、跟催 | `/materials`, `/purchase`, `/kit-closure`, `/material-alerts`, `/critical-parts` |
| 质量与追溯 | 检验、NCR、来料/过程/出厂、五级追溯 | `/quality`, `/spc`, `/trace`, `/tbm-advanced` |
| 设备与维护 | 设备台账、点检、维保、备件、IoT、数字孪生 | `/equipment-ledger`, `/maintenance`, `/field-service`, `/iot`, `/digital-twin` |
| 成本与经营 | 材料、人工、外协、折旧、成本三层差异 | `/cost`, `/cost-variance`, `/business-reports`, `/delivery` |
| 异常与协同 | 缺料、采购、质量、主数据、ANDON 待办 | `/exceptions`, `/andon` |
| 系统管理 | 用户、角色、权限、工位、资质、编码、审计 | `/users`, `/settings`, `/audit`, `/mdm` |

## 2. 登录与角色默认首页

### 2.1 登录

1. 打开 `https://192.168.1.73/login`。
2. 输入账号密码。
3. 登录后系统根据角色进入默认工作区。

### 2.2 角色化默认入口

| 角色 | 默认入口 | 说明 |
|---|---|---|
| `admin` / 管理员 | `/dashboard` | 看全局驾驶舱与全部模块 |
| `warehouse` / 仓库员 | `/shopfloor?tab=pick` | 默认进入领料/退料工作台 |
| `qc` / 质检员 | `/shopfloor?tab=qc` | 默认进入质检录入 |
| `worker` / 工人 | `/shopfloor?tab=scan` | 默认进入扫码报工 |
| `welder` / 焊工 | `/shopfloor?tab=scan` | 默认进入扫码报工 |

前端菜单和后端 API 都有 RBAC 权限控制。数据范围权限（P1-1）进一步限定普通角色只能看到自己权限范围内的数据（`/api/me/scope`）。

## 3. 全流程健康检查（体检仪表盘）

这是「这个项目现在卡在哪」的一屏总览，建议每天班后看一次。

入口：`首页驾驶舱 → 仪表盘 → 全流程健康检查卡片`  
URL：`/dashboard`（或直达 `/dashboard?instance_id=8`）

它把每个项目按 8 个环节体检：

| 环节 | ok（已通）的条件 |
|---|---|
| 项目与里程碑 | 有里程碑 且 有合同号 |
| 设计与 BOM | 有 BOM 行 且 挂物料 且 实装批次覆盖 ≥ 80% |
| 工艺树与排程 | 有工序 且 全部有工位 且 计划时间覆盖 ≥ 80% |
| 派工与报工 | 有工单 且 有派工位 且 报工覆盖 ≥ 工单数 |
| 齐套与领料 | 有领料流水 且 有序列号 |
| 检验与证据 | 有检验 且（有 NDT 或有工单检验） |
| 文档与图纸 | 有关联到该项目的文档 |
| 交付与成本 | 有交付证据（交付里程碑 **或** 交付单）且 成本类型 ≥ 2 类；有交付但无验收单会提示补录 |

- 每个环节显示状态（已通 / 部分 / 未开始）、完成度分数、具体卡点（精确到数字）、「去处理」直达对应页面。
- 「部分」环节按完成度计分（50~99），所以分数会随补数据逐步上升。
- 底部给「下一步建议」最多 3 条。
- 接口：`GET /api/dashboard/process-health?instance_id=`。

使用方式：切换项目下拉看不同项目；卡点逐条认领到责任人，周会按它过。

## 4. 空白系统第一天操作顺序

空白 MES 不建议直接建工单。正确顺序是先把「人、机、料、法、图、项目骨架」建好。

### 第 1 步：建用户、角色、权限

入口：`系统管理 → 用户管理 / 角色与权限 / 角色组`  
URL：`/users?tab=users`, `/users?tab=matrix`, `/users?tab=groups`

1. 创建管理员、生产主管、计划员、仓库员、质检员、工人、采购员、工程师。
2. 给角色分配权限。
3. 使用角色组管理同类岗位；用数据范围（data_scope）限制数据可见性。

### 第 2 步：建工位、人员、供应商

入口：`/workstation-resources`（工位）、`/labor`（人员资质）、`/suppliers`（供应商）

1. 建工位：装配、焊接、机加、检验工位（含班次时长 × 人数，用于工位负荷）。
2. 建人员资源与资质（焊工证、检验证等）。
3. 建供应商并分类。

### 第 3 步：建物料主数据

入口：`采购与库存 → 物料中心`  
URL：`/materials?tab=materials`

1. 新增或导入物料，补齐编码、名称、规格、单位、分类、安全库存。
2. 维护「一物一码」，不允许重复编码、模糊名称、缺单位。

### 第 4 步：建装备实例

入口：`项目与装备 → 装备实例`（或 `/project-wizard` 项目启动向导）  
URL：`/instances`

1. 创建向导填写项目号、合同号、序列号、客户、年份、设备类型、型号。
2. 系统自动生成：合同信息、默认里程碑、生命周期阶段、BOM 根节点、文档目录。
3. **项目信息（客户/合同号/合同金额等）可在实例详情右上角「编辑项目信息」维护；其中「进度」由系统自动回写（工序完成率按标准工时加权，无工序时按工单完成率），只读展示，不再手工填写。**

### 第 5 步：导入或维护 BOM

入口：`设计与BOM → BOM 管理`  
URL：`/bom`

1. 选装备实例，按层级建 0/1/2/3 级 BOM。
2. 用「+ 新增子部件」逐行建：物料（可搜索编码）、数量、单位（与物料主数据一致）、分类、节点类型。
3. 或「CSV 导入」批量导入。
4. 用 BOM 校验、多业务视图（采购/装配/成本/风险）检查。
5. **关键件挂实装批次**（与追溯、量差直接相关）。

### 第 6 步：绑定图纸/文档

入口：`设计与BOM → 文档/图纸`  
URL：`/documents`

1. 上传图纸、SOP、工艺文件、检验标准（支持 PDF/Word/Excel/图片/DWG/STEP，≤50MB）。
2. **关联设备为必填**，可选关联 BOM 节点、ECO；中文文件名、中文标题均支持。
3. 签发文档；现场签收；下载为鉴权 blob 下载（中文名不乱码）。

### 第 7 步：建工艺路线

入口：`/process-tree`（工艺树）、`/process-params`（工艺参数）、`/process-hours`（工时与报工）

1. 建工序：名称、前后依赖、标准工时、工位、技能要求、关键工艺参数。
2. 用 `/gantt`、`/schedule`、`/multi-schedule` 检查路径与工位负荷。

### 第 8 步：生成工单和排程

入口：`/work-orders`（工单）、`/multi-schedule`（多项目资源平衡）、`/gantt`（单项目甘特）

1. 创建工单，关联装备实例、BOM/工艺节点。
2. 下发到班组/工位/人员；排程 dry-run 后正式排程。
3. 看热力图超载工位，可用拖拽改派。

## 5. 项目交付主线操作

### 5.1 生产主管每天第一步

入口：`/dashboard`

1. 看「全流程健康检查」分数与 8 环节状态。
2. 看项目总览、风险待办 —— 风险卡只算**执行风险**（执行中超期 / 长交期关键件 / ECO / 服务工单）；
   **未开工计划过期**单独列在「交付风险雷达」里，属于排程待重排，不算执行风险。
3. 看 OEE、现场实时状态。
4. 有风险进 `/delivery`、`/exceptions`、`/purchase?tab=followup`、`/quality?tab=ncr`。

### 5.2 项目经理看交付

入口：`/delivery`

1. 选 TBM 实例，看合同 → BOM → 图纸 → 采购 → 齐套 → 工单 → 报工 → 质检 → 成本 → 验收。
2. 钻取风险：缺料 / NCR / 成本偏差 / 延误 / 主数据异常，推进关闭。

### 5.3 工程师处理设计变更（ECO）

入口：`/eco`（设计变更）、`/bom`、`/documents`

1. 创建 ECO，评估影响（BOM/图纸/采购/库存/工单/成本）。
2. 修改 BOM 版本、重新签发图纸、推送影响项到异常中心。

### 5.4 采购员处理缺料和跟催

入口：`/purchase?tab=orders`、`/purchase?tab=followup`、`/kit-closure`

1. 齐套检查生成缺料清单 → 生成采购催办 → 分派责任人 → 回写 ETA。
2. 已到货/取消/重新发起时，缺料状态与异常中心联动。

### 5.5 仓库员领料/退料

入口：`/shopfloor?tab=pick`、`/kit-closure`

1. 选工单 → 看 pick-list → 按 BOM 和批次扫码领料 → 库存扣减并记录批次。
2. 关键件登记批次与序列号（`/critical-parts`）。

### 5.6 工人扫码报工

入口：`/shopfloor?tab=scan`（或 `/scan`）

1. 扫工单码/工序码 → 看图纸/标准工时 → 开始/完成 → 填实际工时、数量。
2. **报工工时是 OEE 性能、人工效率差的唯一事实来源，务必每天填写。**

### 5.7 质检员处理质量闭环

入口：`/quality`（检验/NCR/CAPA）、`/spc`（控制图）、`/tbm-advanced`（焊缝/NDT/装配）

1. 来料/过程/出厂检验；不合格建 NCR（返工/返修/让步/报废/退货）；建 CAPA；复检关闭。
2. 焊缝登记编号与参数，NDT 报告关联焊缝编号；装配过程记录。

### 5.8 成本会计/项目经理看成本

入口：`/cost`（成本归集）、`/cost-variance`（项目成本偏差）

成本来源与三层差异见第 8 节。

### 5.9 交付单与验收单

入口：`项目与装备 → 项目装备详情 → 「交付验收」标签页`

- **交付单**：一次发运一条（整机/备件/工装），记录计划与实际日期、运输方式、承运单位、运单号、包装件数、毛重、收货地点、联系人；
  状态机：`已计划 → 已发货 → 运输中 → 已到场 → 已验收`（任意状态可取消，终态不可回退）；
- **验收单**：FAT 厂内 / SAT 现场 / 终验；签署时填结论（通过 / 让步接收 / 不通过）、客户签署人、职务、日期；
  让步接收必须写说明；
- 交付单与验收单都可关联里程碑（软引用），但**不会反向改里程碑**——里程碑仍由项目侧维护。

### 5.10 设备维护和售后

入口：`/maintenance`、`/field-service`、`/equipment-ledger`

建维保计划 → 点检/TPM → 记录故障 → 消耗备件 → 售后记录 → 沉淀故障知识库。

## 6. OEE 与三层基线（ISA-95）

入口：`首页驾驶舱 → OEE`  
URL：`/oee`

- OEE = 可用率 × 性能 × 质量，三层时间基线（ISA-95）。
- 每个班次需要三类显式损失分钟：故障 `fault_minutes`、换型 `changeover_minutes`、待料 `material_wait_minutes`，三者之和等于「计划生产 − 运行」。
- 短停/空转/降速记为 `idle_minutes`（性能损失），计划保养记为 `planned_stop_minutes`。
- 「数据质量」徽标：可校验班次越多越可信；`legacy` = 缺基线，`mismatch` = 损失合计对不上时间差。
- 补录用 `oee-shifts.csv`（模板 + 逐行示例见 `docs/oee-backfill-guide.md`）。

验收：`/oee` 审计口径 `GET /api/oee/overview/audit?days=365` 可校验班次 100%、通过率 100%。

## 7. 端到端追溯（五级链路）

入口：`质量与追溯 → 端到端追溯`  
URL：`/trace`

五级：**装备 → 工单 → 工序 → 批次/序列号 → 检验与证据**。

- 入口可用 装备编码 / 工单号 / 批次号 / 序列号。
- 各级显示证据计数与断点建议（例如「有焊缝但缺 NDT」「序列号 0，只能追到批次」）。
- 接口：`GET /api/trace/chain?instance_code=/wo_code=/lot_no=/serial_no=`。

关键前提：BOM 挂实装批次、关键件登记序列号、质检/NDT/文档关联到工单。

## 8. 成本三层差异与台账核对

入口：`成本与经营 → 成本归集 / 项目成本偏差`  
URL：`/cost`, `/cost-variance`

标准成本法拆三层（正数=超支，负数=节约）：

```text
材料：量差 =（实际用量 − 标准用量）× 标准单价
      价差 =（实际单价 − 标准单价）× 实际用量
      合计 = 实际成本 − 标准成本 = 量差 + 价差
人工：效率差 =（实际工时 − 标准工时）× 标准费率
      费率差 =（实际费率 − 标准费率）× 实际工时
```

- 口径自带自检（`reconciled=true`）。
- **诚实标注**：未领料、未报工不计入合计（进 `not_computed`），不把「没数据」算成「节约」；`confidence=full/partial`。
- 台账核对：外协/折旧/返工/质量损失单列 `ledger.other_costs`，并与「按领料×单价、工时×费率」的计算值做 `cross_check`（账实差）。
- 成本台账导入用 `cost-entries.csv`（类型：material/labor/outsourcing/depreciation/rework/quality_loss）。

## 9. 工位负荷与排程改派

入口：`生产执行 → 多项目资源平衡`  
URL：`/multi-schedule`

- 工位 × 日 热力图：红色 = 超载（>100%），Top3 最紧工位卡片。
- 点击格子看当日在制任务并可改派。
- 两种拖拽改派：
  - 格子 → 格子：把某工位某天拖到另一工位，弹窗预置目标，确认后保存。
  - 任务 → 工位：弹窗内任务手柄拖到下方工位标签。
- 工单级改派：`PUT /api/work_orders/:id/workstation`；工序级：`PUT /api/process_nodes/:id/assign`。
- 拖拽只预置、不自动提交；保存后自动刷新热力图与 Top3。

## 10. 数据补录工具（导入）

对批量历史数据，用命令行补录（不逐条手点）：

```bash
# 生成模板
node scripts/gen-backfill-templates.js --type=bom-lots|lots|serials|oee-shifts|cost-entries

# 试运行（不写库，看"将写入 N 处 / 错误 M 处"）
node scripts/data-backfill.js --type=<type> --csv=xxx.csv

# 正式导入（写前检查备份 < 6 小时）
node scripts/data-backfill.js --type=<type> --csv=xxx.csv --apply

# 回滚（边车记录）
node scripts/data-backfill.js --rollback=data/backfill/batch-<时间戳>-<type>.json
```

| 类型 | 目标表 | 用途 |
|---|---|---|
| `bom-lots` | `instance_bom.material_lot_id` | 给 BOM 行挂实装批次（量差/追溯） |
| `lots` | `material_lots` | 建物料批次 |
| `serials` | `serial_numbers` | 关键件序列号 |
| `oee-shifts` | `oee_shift_log` | OEE 三层基线 |
| `cost-entries` | `project_cost_entries` | 成本台账 |

CSV 支持 GBK/UTF-8 自动识别；日期支持 `2026-10-15` / `2026/10/15`；去重（按 source_ref 或关键字段）；报错精确到行号。详见 `docs/backfill.md`。

## 11. MCP 只读工具（供 AI 助手查询）

系统内置 8 个只读 MCP 工具，供外部 AI 助手按当前用户权限查询：

| 工具 | 作用 |
|---|---|
| `mes_work_order_progress` | 工单进度 |
| `mes_material_shortage` | 缺料 |
| `mes_oee` | OEE |
| `mes_qc_pass_rate` | 质检合格率 |
| `mes_anomalies` | 异常中心 |
| `mes_cost_variance` | 项目成本三层差异 + 台账核对 |
| `mes_trace_chain` | 追溯五级链路 |
| `mes_workstation_load` | 最紧/最空闲工位与负荷 |

工具继承 P1-1 数据范围，普通用户只能查到权限内数据。启动：`npm run --silent mcp`（或 `node scripts/mcp-server.js`）。详见 `docs/mcp.md`。

## 12. 异常中心闭环

入口：`异常与协同 → 异常中心`  
URL：`/exceptions`

| 异常类型 | 来源 | 责任部门 |
|---|---|---|
| 缺料异常 | 齐套检查、库存预警、BOM 风险 | 仓库/采购 |
| 采购延期 | 采购跟催、ETA 逾期 | 采购 |
| 质量 NCR | 质检管理 | 质量/生产/供应商 |
| 工单延期 | 排程、Gantt、延误预警 | 生产 |
| 图纸未签收 | 文档/图纸 | 工程/车间 |
| 资质过期 | 劳动力管理 | 生产/HR |
| 主数据异常 | 主数据治理 | 数据管理员 |
| 设备故障 | ANDON、设备维护 | 设备/维修 |

标准动作：接收 → 指派责任人 → 填原因 → 定措施 → 回写业务状态 → 关闭 → 看板消警。

## 13. 常用角色操作速查

### 13.1 生产主管

1. `/dashboard` 看健康检查 + 驾驶舱。
2. `/delivery` 看每台 TBM 卡在哪。
3. `/exceptions` 处理红色风险。
4. `/multi-schedule`、`/gantt` 调整排程与工位负荷。
5. `/work-orders?tab=dispatch` 派工。
6. `/process-hours` 看工时偏差。
7. `/quality?tab=ncr` 跟踪质量。

### 13.2 计划员

1. `/instances` 确认实例。
2. `/process-tree` 确认工艺树。
3. `/work-orders` 建工单。
4. `/multi-schedule`、`/gantt` 排程。
5. `/kit-closure` 检查齐套。

### 13.3 工程师 / 工艺员

1. `/bom` 维护 BOM（挂批次）。
2. `/documents` 上传签发图纸。
3. `/eco` 设计变更。
4. `/process-tree`、`/process-params` 工艺与参数。
5. `/spc` 过程能力。

### 13.4 采购员

1. `/purchase?tab=orders`、`?tab=followup`、`?tab=suppliers`。
2. `/kit-closure` 看缺料。
3. `/exceptions?type=purchase_delay`。

### 13.5 仓库员

1. `/shopfloor?tab=pick` 领料/退料。
2. `/materials?tab=inv` 库存。
3. `/material-alerts` 预警。
4. `/kit-closure` 齐套/缺料。
5. `/critical-parts` 关键件批次/序列号。
6. `/documents` 查图纸/SOP。

### 13.6 质检员

1. `/quality?tab=inspections` 检验。
2. `/quality?tab=ncr` NCR/CAPA。
3. `/tbm-advanced` 焊缝/NDT/装配记录。
4. `/spc` 控制图。
5. `/trace` 追溯。

### 13.7 维修/售后

1. `/maintenance`、`/field-service` 维保计划与点检。
2. `/equipment-ledger` 设备台账。
3. `/iot`、`/digital-twin` 状态监控。

## 14. 数据质量红线

1. 物料编码混乱：库存、采购、成本全不准。
2. BOM 不按层级、不挂批次：齐套、领料、量差、追溯全部失效。
3. 图纸版本不签发：现场可能拿错图纸。
4. 工艺路线无标准工时：排程与成本不可信。
5. 工单不报工：进度、OEE 性能、人工效率差失真。
6. 采购 ETA 不回写：交付看板无法判风险。
7. NCR 不闭环：质量无法追溯复盘。
8. 异常只开不关：看板长期红灯。
9. 关键件无序列号：单件追溯断在批次级。
10. 成本台账只有人工一类：三层差异不完整。

## 15. 故障排查速查

| 现象 | 常见原因 | 处理 |
|---|---|---|
| 登录后跳不进去 | token 过期、角色默认页受限 | 重新登录；查角色权限 |
| 页面提示 401 | 未登录或 token 无效 | 重新登录 |
| 页面提示 403 | 角色无权限或数据范围限制 | `/users` 查权限；`/api/me/scope` 查范围 |
| 页面提示 404 | 未注册 API 或旧静态资源 | 强刷（Ctrl+Shift+R）；确认后端已重启 |
| 页面提示 500 | 后端异常或数据不完整 | 看 `logs/mes.log` |
| 左侧菜单少 | 角色权限过滤 | 用 admin 对比 |
| 健康检查下拉选了没反应 | 旧前端 bundle | 强刷浏览器 |
| 进度显示不对 / 一直是 0 | 老数据未回写（已改为触发器自动回写） | `/instances/:id` 点「重算进度」，或调 `POST /api/equipment_instances/progress/recalc-all` |
| 合同等字段改不了 | 详情页无入口（已补） | `/instances/:id` 右上角「编辑项目信息」 |
| BOM 新增行物料下拉无数据 | 旧版本取值 bug（已修） | 强刷后重试 |
| 上传提示「请先选择文件」 | 旧版本 ElUpload bug（已修） | 强刷后重试 |
| 上传提示「请选择关联设备」 | 文档未选装备（必填） | 选关联设备 |
| 下载 401 | URL 带 token（已改 blob） | 强刷后重试 |
| 导入报错 | 列缺/日期格式/编码 | 看报错行号，按 `docs/backfill.md` 改 |
| 齐套不准 | BOM/库存/编码不完整 | 回物料中心与 BOM 校验 |

## 16. 推荐上线使用节奏

### 第 1 周：让系统「能跑」

用户/权限 → 工位/人员/供应商 → 物料主数据 → 装备实例 → BOM → 图纸签发 → 工艺树 → 工单排程。每周用健康检查确认各环节转「已通」。

### 第 2 周：让现场「真用」

扫码报工、领料/退料、来料/过程/出厂检验、缺料进异常中心、采购 ETA 回写、关键件序列号。

### 第 3-4 周：让管理「可信」

项目交付看板、成本三层差异与台账核对、NCR/CAPA 闭环、OEE 三层基线、五级追溯、维保/备件/售后。目标：健康检查 ≥ 85 分（流程健康）。

## 17. 当前模块成熟度判断

| 模块 | 当前判断 | 使用建议 |
|---|---|---|
| 用户/权限/RBAC | 基础闭环 + 数据范围 | 角色组统一治理 + data_scope |
| 物料/库存/批次 | 主数据、库存、批次、导入 | 上线前清洗编码 |
| 装备实例 | 创建向导、生命周期、编辑项目信息、**进度自动回写** | 作为项目主入口 |
| BOM 管理 | 4 级结构、多视图、批次挂载、风险闭环 | 按层级建 + 挂批次 |
| 文档/图纸 | 上传、版本、签发、签收、中文名下载 | 现场使用前签发 |
| 工艺树/工时 | 工艺树、标准工时、报工 | 排程前补工位与工时 |
| 工单/排程 | 工单、派工、Gantt、工位负荷、拖拽改派 | dry-run 后再正式排程 |
| 齐套/采购/跟催 | 缺料闭环、采购反闭环 | ETA 及时回写 |
| 质量/NCR/CAPA | 质量闭环、焊缝/NDT/装配 | NCR 必须关闭 |
| 追溯 | 五级链路 + 断点建议 | BOM 挂批次 + 序列号 |
| OEE | ISA-95 三层基线 + 口径自检 | 班次损失分钟要真实 |
| 成本 | 三层差异 + 台账核对 | 台账 ≥2 类、领料/报工要全 |
| 全流程健康检查 | 8 环节体检 + 完成度计分 | 每天班后看、周会过 |
| MCP 工具 | 8 个只读查询 | 供 AI 助手按权限查询 |
| 数据补录 | 5 类模板 + dry-run/apply/rollback | 批量历史数据用它 |
| 异常中心 | 统一待办池 | 跨部门问题都进这里 |
| 交付/验收单据 | 交付单 + 验收单（FAT/SAT/终验）+ 状态机 | 交付前建交付单、验收后签署 |
| 设备维护/售后 | 计划、日志、备件、故障 | 交付后运维阶段用 |

## 18. 最短业务路径 + 培训演练

### 18.1 最短闭环

1. `/users` 建用户角色 → 2. `/workstation-resources` 建工位 → 3. `/suppliers` 建供应商 → 4. `/materials` 建物料 → 5. `/instances` 建实例 → 6. `/bom` 建 BOM（挂批次） → 7. `/documents` 传图纸 → 8. `/process-tree` 建工艺 → 9. `/process-hours` 设标准工时 → 10. `/work-orders` 建工单 → 11. `/kit-closure` 齐套 → 12. `/shopfloor?tab=pick` 领料 → 13. `/shopfloor?tab=scan` 报工 → 14. `/quality` 质检 → 15. `/cost-variance` 看成本差异 → 16. `/instances/:id` 交付验收标签页建交付单/验收单 → 17. `/delivery` 看交付 → 18. `/dashboard` 看健康检查是否 ≥85。

### 18.2 培训演练（12 步）

系统内置演练机 `TBM-DEMO-001`（实例 ID 8），专用于熟悉全流程操作、不参与真实经营统计。按 `docs/training-drill-12steps.md` 的 12 步演练脚本，从建 BOM 一路走到成本，每一步都有健康分反馈（起始 28.1 分 → 全程做完 100 分）。练完可归档或让管理员新建 `TBM-DEMO-002`。
