# 报表 / 聚合只读视图（Read Model）

> 建立日期：2026-11-02（报表看板）；2026-11-02 追加成本归集  
> 归属模块：`services/reportService`、`services/cost/rollup`  
> 代码位置：`services/reportService/schema.js`、`services/cost/rollup/readModel.js`

## 1. 为什么要有这一层

报表 / 看板 / 健康检查 / 成本归集属于「聚合模块」：它们天生要读遍全库。之前的写法是直接在
接口里 `SELECT ... FROM work_orders / process_nodes / qc_inspections / documents / instance_bom ...`，
导致：

- 跨域 SQL 散落在业务代码里，改表时容易漏；
- 一个接口几十次 `COUNT(*)`，语句准备开销大；
- 想拆模块时，这些散落的跨域读是第一个绊脚石。

现在改成：**跨域读集中到一个文件里的只读视图，聚合模块只读视图。**

| 角色 | 允许做的事 |
|---|---|
| 业务模块（工单/质检/物料/成本台账…） | 读写自己的表 |
| 聚合模块（reportService / cost.rollup） | 只读 `v_*` 视图，不直接写别的模块的表 |
| 视图 | 只读（`CREATE VIEW`），不参与任何写入/事务 |

## 2. 视图清单

### 2.1 报表看板（`services/reportService/schema.js`，8 个）

| 视图 | 用途 | 被谁用 |
|---|---|---|
| `v_risk_counts` | 风险口径 5 个计数 | `/api/dashboard/risk-summary` |
| `v_dashboard_counts` | 看板头部 12 个标量（内联 `v_risk_counts`） | `/api/dashboard` |
| `v_work_order_status_counts` | 工单按状态分组 | `/api/dashboard` |
| `v_process_node_status_counts` | 工序按状态分组 | `/api/dashboard` |
| `v_instance_status_counts` | 项目按状态分组 | `/api/dashboard` |
| `v_long_leadtime_components` | 长交期关键件（≥12 周） | `/api/dashboard/long-leadtime` |
| `v_instance_health_metrics` | 一实例一行的 8 环节全部计数 | `/api/dashboard/process-health` |
| `v_instance_live_status` | 在健康指标上收敛的现场实时状态 | `/api/dashboard/live-status` |

### 2.2 成本归集（`services/cost/rollup/readModel.js`，7 个）

| 视图 | 用途 | 被谁用 |
|---|---|---|
| `v_instance_contract_summary` | 项目合同摘要（实例字段） | rollup / breakdown 取实例信息 |
| `v_instance_bom_key_component_lines` | 关键件成本明细（**每行 BOM 一条**） | breakdown 明细 |
| `v_instance_bom_material_lines` | 普通物料成本明细（**每行 BOM 一条**） | breakdown 明细 |
| `v_instance_key_component_costs` | 关键件成本（**按关键件聚合**） | rollup 汇总 |
| `v_instance_material_costs` | 普通物料成本（**按物料聚合**） | rollup 汇总 |
| `v_instance_labor_totals` | 工时汇总（每实例一行，无工单也返回 0） | rollup / breakdown |
| `v_instance_cost_entry_lines` | 成本台账行（过滤作废/已删除，带中文类型标签） | breakdown 明细 |

> **两组粒度是刻意分开的**：`*_lines` 保持"每行 BOM 一条"（明细要按 BOM 行展开），
> `*_costs` 按物料/关键件聚合（汇总要 SUM 数量）。合并成一套会改变 breakdown 的行数。

## 3. 收益（2026-11-02 实测）

| 接口 | 改造前 | 改造后 |
|---|---|---|
| `/api/dashboard` | 7 次独立查询 | 1 次（视图内联风险口径）+ 3 次分组查询 |
| `/api/dashboard/process-health` | 每实例约 22 次 `COUNT(*)`（5 实例 ≈ 110 次） | **1 次查询**（预热中位 11ms → 5ms） |
| `/api/equipment_instances/:id/cost_rollup` | 4 段跨域 JOIN（实例/BOM/关键件/工时） | 3 次视图查询（预热中位 4ms） |
| `/api/equipment_instances/:id/cost_rollup/breakdown` | 4 段跨域 JOIN + 表存在性判断 | 4 次视图查询（预热中位 4ms） |
| 跨域 SQL 位置 | 散落在 3 个接口文件 | 集中在 2 个 schema 文件 |

**所有接口响应体与改造前逐字节一致**（用基线快照比对：看板 5 个 + 成本 8 个接口）。

## 4. 改动流程（必须遵守）

视图是 DDL，走服务 schema 版本管理：

```bash
# 1. 改 services/reportService/schema.js 或 services/cost/rollup/readModel.js
# 2. 提升 services/registry/*.js 里对应服务的 schemaVersion
# 3. 重新生成 DDL 指纹清单
npm run schema:write
# 4. 本地校验
npm run schema:check
# 5. 重启服务（新版本号触发视图重建）
systemctl --user restart factory-mes.service
```

> ⚠️ **SQLite 没有 `CREATE OR REPLACE VIEW`**。所以视图定义里用的是
> `DROP VIEW IF EXISTS ...; CREATE VIEW ...`，否则已有库会保留旧定义（`CREATE VIEW IF NOT EXISTS`
> 不会更新已存在的视图）。同理：**改了视图就必须升 schemaVersion**，否则指纹校验会拒绝启动。

## 5. 已知约束

1. **命名**：视图统一 `v_` 前缀；`sqlite_master` 里 `type='view'`。
2. **只读**：视图不提供写入路径；业务写入仍走各自的表与事务。
3. **表重建兼容**：`process_nodes` 重建（`services/processTree/repairBomForeignKey.js`）会先删除
   依赖它的视图、重建后再按原样恢复，避免 SQLite 在 `ALTER TABLE RENAME` 时解析视图报错。
4. **不做参数化**：视图不能带参数。需要按实例/日期过滤的查询，在视图里保留 `instance_id` 等
   维度列，由接口 `WHERE instance_id = ?` 过滤。
5. **空集合语义**：`v_instance_labor_totals` 的 `completed_count` 在无工单时返回 **NULL**（不是 0），
   与改造前 `SUM(CASE ...)` 的口径保持一致；改这里会破坏接口逐字节一致性。
