# 11 模块批量审计与修复报告

> 审计日期：2026-11-07  
> 范围：设计变更 ECO、工艺树、工序/岗位配置、工艺参数、SPC 控制图、物料中心、单位换算、库存清单、库存预警、采购管理、供应商管理  
> 方式：三路并行审计（A：ECO/工艺；B：SPC/物料/库存；C：采购/供应商），Lead 统一整合共享权限、跑全量闸门、生产重启冒烟

## 0. 结论

**11 个模块全部完成审计与修复（P1/P2 全修，P3 记录）**。新增回归测试 44 例，全量部署闸门 **889/0**，生产重启后 23 项接口冒烟通过（2 项为“接口不存在/物料不存在”的测试参数问题，已改用真实数据验证通过）。

## 1. 分模块结果

| 模块 | 主要发现（级别） | 修复要点 | 验证 |
|---|---|---|---|
| 设计变更 ECO | P1 `POST /instance_eco/:id/transit` 未命中权限规则（受限 token 400 而非 403）；P1 影响分析无 BOM 命中时提前返回，隐藏未关闭采购单（ECO#1 仅 score=2，实际应 8）；P2 approved/closed 可编辑、eco_no 可重复、无审计 | 路由内 `equipment:write/process:write` 校验；影响分析始终计算并加 eco_id 过滤；状态冻结编辑、eco_no 409、404、create/update/transit 审计；PLM ECO `draft→approved→implemented` 状态机；前端按状态显示操作 | auditEcoProcess 12/12；smoke 200 |
| 工艺树 | P1 `DELETE /process_nodes/:id` 无引用保护（工单/排程/报工孤儿、子节点变根）；P1 PUT 布尔 true 触发 better-sqlite3 TypeError（编辑质检/SOP 500）；P2 跨实例父节点/自环/成环/BOM 归属/负工时/worker_count 未校验 | 引用检查 409 + 事务级联删除 + 审计；布尔统一 0/1；父子/环/BOM/工时校验；execute/move/assign 审计 | auditEcoProcess；parts_tree/critical_path 200 |
| 工序/岗位配置 | P2 重复编码 500、负工时、0 定员、未知岗位、文档绑定无校验、无审计 | 编码冲突 409；工时>0、定员≥1、岗位存在、文档存在；CRUD 审计 | process-master 3 接口 200；回归 37/37 |
| 工艺参数 | P1 `GET /process/monitor` 500（`pn.node_type` 列不存在）；P2 读数无边界、spec 无 lsl≤usl/key 校验、每次插入新行导致偏差失效 | 修复查询列；数值/JSON/边界校验；spec 更新最近行；偏差/趋势取最近真实读数；审计 | monitor 200（87 节点）；auditEcoProcess 通过 |
| SPC 控制图 | P1 非法 limit 500→400；P1 xbar-r 等 404→补齐；P1 σ=0 时 cpk=Inf→null；P2 ack 无 404/审计、告警去重粗、规格限回看仅 50 | 参数校验、补齐图表类型、CPK 空值处理、ack 审计、告警规则+未确认抑制、规格限回看扩展 | auditInventorySpc 18/18；spc 3 接口 200 |
| 物料中心 | P1 导入缺库存/单价 NOT NULL 500；P2 负库存/负价可入库 | 导入兜底 0；负值校验 + 审计 | materials/import template 200；物料回归 42/42 |
| 单位换算 | P1 负/NaN factor、id=undefined；P2 重复 500、删不存在 500、删除被引用 | factor>0 有限数、id 必填；重复 409、404、引用保护 409 | 物料 25 单位查询 200（factor=5） |
| 库存清单 | P1 `Math.abs` 接受负/NaN；隔离批次可出库；负数入库/拆批、字符串 id 合批；P2 跨工单释放无净额校验 | 有限数/正数校验、仅 available 可出库、拒绝负数量/非法 id、净额校验 | inventory 200；回归 6/6 |
| 库存预警 | P2 忽略 reorder_point（只看 safety_stock）；P2 lead-times 任意登录可写 | 阈值取 `max(safety_stock, reorder_point)`；写权限 `material:write` | inventory/alerts 200；阈值 1500 验证 |
| 采购管理 | P1 收货接受 `submitted` 绕过审批；P2 停用供应商可下单、发票 matched/paid 无三单一致、金额/税额无有限数校验、对账漏税、关键动作无审计 | 收货限 confirmed/in_transit/partially_received；供应商启用+项目存在；有限数/税额≤金额；matched 净额不等等 409；对账含税/超额；收货/发票/状态审计 | auditPurchaseSupplier 14/14；purchaseChain 6/6 |
| 供应商管理 | P1 删除仅查采购单，外协/检验引用成孤儿；P1 外协创建非事务（评分失败留孤儿）；P2 rating/分类/is_active/编码大小写、评分范围、看板任意登录可读 | 三表引用 409、评分快照事务清理；外协先校验供应商+事务；validation.js 统一校验；关键动作审计；看板权限 `purchase:read|quality:write` | supplier/supplier-collab/dashboard 冒烟 200/403 正确 |

## 2. Lead 统一完成的共享改动

| 文件 | 改动 |
|---|---|
| `middleware/apiPermissions.js` | `/supplier/dashboard`、`/supplier-collab` 显式规则（读取改为 `purchase:read OR quality:write`，防止有 quality:read 的工人越权查看供应商/采购数据）；`/instance_eco/:id/transit` 写规则；`/equipment_instances/:id/process_tree/generate` 允许 `process:write`；`/materials/import/*`、`/material-planner/*` 显式规则（原未命中规则=默认放行） |
| `services/purchase/orderRoutes.js` | 采购单关闭/作废要求 `purchase:admin`（admin 角色放行），高危操作收紧 |
| `services/supplierDashboardService.js` | 看板路由级守卫同步收紧为 `purchase:read|quality:write` |
| `material_lots.quality_status` | 存量 `pass` 5 行归一为 `passed`（现 8 passed / 12 pending），避免领料误判隔离 |

## 3. 验证

| 项目 | 结果 |
|---|---|
| 新增回归 | `auditEcoProcess` 12/12、`auditInventorySpc` 18/18、`auditPurchaseSupplier` 14/14 |
| 全量部署闸门 | **889/0** ✅（含既有 845 + 新增 44） |
| 既有回归 | purchaseChain 6/6、purchase 6/6、purchaseReceiving 3/3、materialService 42/42、materialChain 6/6、pickService 3/3、andonSplit 5/5、errorPaths 10/10 等 |
| 前端 eslint / vue-tsc / build | 0 / 0 / 通过 |
| 生产重启冒烟 | 23 项接口：21 项直接 200；`/materials/1/units`（物料 1 不存在，改物料 25→200）、`/material_units`（无 GET 列表接口，单位查询走 `/materials/:id/units`） |
| 权限冒烟 | worker：`/supplier/dashboard` 403、`/supplier-collab/overview` 403、`/material-planner/mrp` 403；qc：`/supplier/dashboard` 200 |

## 4. 剩余 P3（记录，未在本轮修复）

1. ECO 无“作废”状态；`process_tree/generate` 只读不生成（UI 文案需产品确认）；
2. `process_params` 无独立 spec 表；`generate-missing` 模板/顺序重复；
3. `spc_alerts` 无复发计数字段；规格限回看窗口固定；
4. `inventory` 无 DB CHECK、无 `work_order_id` 列；清单无分页；
5. `material_lots.quality_status` 代码已归一，但历史其他表（来料检验）仍可能有 pass/fail 词表差异；
6. 6 张历史非 draft 采购单无审批人；`purchase_order_items/po_lines` 双表遗留；取消复用 `closed_at`；
7. 无物料停用/软删端点；`material_units` 仅单向比率、无换算计算 API；
8. `/api/material_units` 无 GET 列表接口（只能按物料查询）。

> 说明：工艺树 `process_tree/generate` 当前实现为“只读/不生成”，本轮未改其业务语义（需产品决策）；ECO 唯一索引、inventory 新列等 DDL 未做，避免 registry/迁移风险。
