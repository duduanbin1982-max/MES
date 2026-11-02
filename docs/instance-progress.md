# 项目进度回写（Instance Progress）

> 建立日期：2026-11-02  
> 代码：`services/equipment/progressModel.js`（视图 + 触发器）、`services/equipment/progress.js`（补数）  
> 目的：修掉「项目进度不回写」断点 —— 工单/工序干完了，`equipment_instances.progress_pct` 还是 0

## 1. 口径

```
weight_i = 工序 estimated_hours（缺失或 ≤0 时按 1）
score_i  = completed 100 / in_progress 50 / 其它 0
pct      = round( Σ(weight_i × score_i) / Σ weight_i )

没有工序       → 退化为工单完成率：completed / total × 100
两者都没有     → 0
```

- **按标准工时加权**：一个 200h 的总装工序完成，比 10 个 2h 的小工序完成更能代表进度；
- **进行中按 50%**：避免"开工了但进度还是 0"；也避免按实际工时会因为报工缺失而虚高；
- 缺工时的工序按权重 1 计，不会因为没填工时被算成 0 权重。

## 2. 怎么保证"自动回写"

公式只写一处：视图 `v_instance_progress_calc`（一实例一行，含 `pct` / `source` / 各项计数）。

回写靠 **6 个触发器**（`process_nodes` / `work_orders` 各自的 INSERT / UPDATE / DELETE）：

```sql
CREATE TRIGGER trg_progress_nodes_ai AFTER INSERT ON process_nodes
BEGIN
  UPDATE equipment_instances
     SET progress_pct = COALESCE((SELECT pct FROM v_instance_progress_calc WHERE instance_id = NEW.equipment_instance_id), 0),
         updated_at = datetime('now')
   WHERE id = NEW.equipment_instance_id
     AND progress_pct IS NOT COALESCE((SELECT pct FROM v_instance_progress_calc WHERE instance_id = NEW.equipment_instance_id), 0);
END;
```

要点：
- **只在进度真的变化时写库**（`progress_pct IS NOT ...`），避免 `updated_at` 被无意义刷新；
- 工序/工单**换了归属实例**时，旧实例也会重算（UPDATE 触发器里的第二条语句）；
- 不依赖任何业务代码记得调 —— 扫码、工单流转、工序动作、CSV 导入，全部自动覆盖。

> 为什么用触发器而不是在每个写路径里调一次函数：全仓有 16 处写 `process_nodes`、9 处写 `work_orders`，
> 逐个埋点必然会漏。触发器是唯一能保证"一个都不漏"的做法。

## 3. 与手工编辑的关系

进度是**派生字段**，不再支持手工改：

| 入口 | 行为 |
|---|---|
| 实例详情「编辑项目信息」 | 进度滑块**只读**，并提示"由系统自动计算" |
| 保存项目信息 | 前端不再提交 `progress_pct`（避免覆盖系统计算值） |
| 实例详情「重算进度」按钮 | 调补数接口，返回 `pct` 与来源（工序完成率 / 工单完成率 / 暂无） |

## 4. 补数接口

```
POST /api/equipment_instances/:id/progress/recalc       # 单个实例
POST /api/equipment_instances/progress/recalc-all       # 全量（首次上线/巡检用）
```

返回：

```json
{ "found": true, "id": 1, "pct": 24, "previous": 0, "changed": true,
  "source": "process_nodes",
  "detail": { "nodes_total": 156, "nodes_completed": 3, "nodes_in_progress": 4,
              "weight_total": 946, "work_orders_total": 3, "work_orders_completed": 2 } }
```

`recalc-all` 返回 `{ total, changed, as_of, items }`，只写有变化的实例。

## 5. 上线首次数值（2026-11-02）

| 实例 | 改前 | 改后 | 来源 |
|---|---|---|---|
| TBM-2026-001（试点） | 0% | **24%** | 工序 156 道（3 完成 / 4 进行中，权重 946h） |
| TBM-2026-002 | 0% | **82%** | 工序 7 道（1 道 200h 完成 / 权重 244h） |
| TBM-2026-003 / 2000顶管机 | 0% | 0% | 无工序、无工单 |
| TBM-DEMO-001（演练机） | 5%（手工） | 0% | 无工序、无工单（手工值被自动口径覆盖） |

> 实例 2 的 82% 看起来高，是因为它 7 道工序里有一道 200h 的总装工序已完成（占 244h 的 82%）。
> 这就是"按工时加权"的设计意图；如果希望按工序数平均，改视图里的 `weight` 表达式即可（需升 equipment schemaVersion）。

## 6. 已知限制

1. **工序工时缺失**：权重退化为 1，此时等价于"按工序数平均"；建议把关键工序的 `estimated_hours` 补齐。
2. **进行中固定 50%**：不按报工进度细化（报工数据本身还不完整）。
3. **只反映"计划工序"完成度**：不包含采购/齐套/检验进度 —— 这些在「全流程健康检查」里单独看。
4. **触发器属于跨域 DDL**（在 process_nodes / work_orders 上建），已在 `config/moduleBoundaries.json`
   的 `allowedTriggers` 登记原因，模块边界检查会拦住未登记的新触发器。
