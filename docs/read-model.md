# 报表只读视图（Read Model）

> 建立日期：2026-11-02  
> 归属模块：`services/reportService`（CORE）  
> 代码位置：`services/reportService/schema.js`

## 1. 为什么要有这一层

报表 / 看板 / 健康检查属于「聚合模块」：它天生要读遍全库。之前的写法是直接在接口里
`SELECT ... FROM work_orders / process_nodes / qc_inspections / documents ...`，
导致：

- 跨域 SQL 散落在业务代码里，改表时容易漏；
- 一个接口几十次 `COUNT(*)`，语句准备开销大；
- 想拆模块时，这些散落的跨域读是第一个绊脚石。

现在改成：**跨域读集中到一个文件里的只读视图，聚合模块只读视图。**

| 角色 | 允许做的事 |
|---|---|
| 业务模块（工单/质检/物料/成本…） | 读写自己的表 |
| 聚合模块（reportService） | 只读 `v_*` 视图，不直接写别的模块的表 |
| 视图 | 只读（`CREATE VIEW`），不参与任何写入/事务 |

## 2. 视图清单

| 视图 | 用途 | 被谁用 |
|---|---|---|
| `v_risk_counts` | 风险口径 5 个计数（延误工单/延误工序/长交期/待处理 ECO/服务工单） | `/api/dashboard/risk-summary` |
| `v_dashboard_counts` | 看板头部 12 个标量（复用 `v_risk_counts`） | `/api/dashboard` |
| `v_work_order_status_counts` | 工单按状态分组 | `/api/dashboard` |
| `v_process_node_status_counts` | 工序按状态分组 | `/api/dashboard` |
| `v_instance_status_counts` | 项目按状态分组 | `/api/dashboard` |
| `v_long_leadtime_components` | 长交期关键件（≥12 周，带物料编码/名称） | `/api/dashboard/long-leadtime` |
| `v_instance_health_metrics` | 一实例一行的 8 环节全部计数（里程碑/BOM/工序/工单/领料/检验/文档/成本） | `/api/dashboard/process-health` |
| `v_instance_live_status` | 在健康指标上收敛出的现场实时状态 | `/api/dashboard/live-status` |

## 3. 收益（2026-11-02 实测）

| 接口 | 改造前 | 改造后 |
|---|---|---|
| `/api/dashboard` | 7 次独立查询 | 1 次（视图内联风险口径）+ 3 次分组查询 |
| `/api/dashboard/process-health` | 每实例约 22 次 `COUNT(*)`（5 个实例 ≈ 110 次） | **1 次查询** |
| 跨域 SQL 位置 | 散落在 dashboard.js | 集中在 `schema.js` 一处 |

响应体逐字段与改造前一致（已用基线快照比对 5 个接口）。

## 4. 改动流程（必须遵守）

视图是 DDL，走服务 schema 版本管理：

```bash
# 1. 改 services/reportService/schema.js 里的视图定义
# 2. 提升 services/registry/core.js 里 reportService 的 schemaVersion
# 3. 重新生成 DDL 指纹清单
npm run schema:write
# 4. 本地校验
npm run schema:check
# 5. 重启服务（新版本号触发视图重建）
systemctl --user restart factory-mes.service
```

> 注意：同一个 `schemaVersion` 下的 DDL 指纹一旦变化，启动会直接报
> `DDL fingerprint changed; increment schemaVersion`。所以**改了视图就必须升版本号**。

## 5. 已知约束

1. **命名**：视图统一 `v_` 前缀，避免和业务表混淆；`sqlite_master` 里 `type='view'`。
2. **只读**：视图不提供写入路径；业务写入仍走各自的表与事务。
3. **表重建兼容**：`process_nodes` 重建（`services/processTree/repairBomForeignKey.js`）会先删除
   依赖它的视图、重建后再按原样恢复，避免 SQLite 在 `ALTER TABLE RENAME` 时解析视图报错。
4. **不做参数化**：视图不能带参数，需要按日期过滤的查询（如「某天的延误」）仍在接口里拼
   `WHERE`，或另建专用视图。
