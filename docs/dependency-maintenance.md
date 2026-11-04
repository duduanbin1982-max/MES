# 依赖维护（类型 / 间隔）

> 入口：`项目排程 /schedule → 甘特图 → 右上角「依赖维护」`  
> 代码：`services/process/node/dependencies.js`（后端）、`frontend/src/views/schedule/DependencyAdminDrawer.vue`（抽屉）、`frontend/src/domain/dependencyAdmin.ts`（表单纯逻辑）  
> 2026-11-05 扩展：原来只有 POST/DELETE，现在补了列表、编辑类型与间隔、环检测。

## 1. 为什么需要它

甘特图的依赖箭头支持 `lag_hours` 偏移（有间隔的线画虚线并错开），但生产 89 条依赖全是 `FS + 0h`——因为**没有界面能改类型和间隔**。本次补齐。

## 2. 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/process_dependencies?instance_id=&predecessor_id=&successor_id=` | 列表（带工序名/状态/计划时间）+ 该项目的工序选项（`nodes`） |
| POST | `/api/process_dependencies` | 新增：`{equipment_instance_id?, predecessor_id, successor_id, dep_type, lag_hours}`（instance 可从工序推导） |
| PUT | `/api/process_dependencies/:id` | 修改 `dep_type` / `lag_hours` / 端点（改端点会重新做环检测） |
| DELETE | `/api/process_dependencies/:id` | 删除 |

列表返回示例：

```json
{
  "total": 89,
  "items": [{
    "id": 93, "predecessor_id": 135, "successor_id": 136,
    "dep_type": "FS", "lag_hours": 0,
    "predecessor_name": "下料", "successor_name": "卷制/成型",
    "predecessor_status": "ready", "successor_status": "in_progress"
  }],
  "nodes": [{ "id": 135, "operation_name": "下料", "status": "ready", "planned_start": "2026-11-10" }]
}
```

## 3. 校验规则（后端强校验）

| 规则 | 行为 |
|---|---|
| 必填 | `predecessor_id` / `successor_id` 缺失 → 400 |
| 工序存在 | 任一端不存在 → 400（提示具体 id） |
| 同项目 | 两端 `equipment_instance_id` 不同 → 400「前驱与后继不属于同一个项目」 |
| 自依赖 | 前驱 = 后继 → 400「不能把工序依赖到它自己」 |
| 重复 | 同方向已存在 → 400（提示已有 id） |
| **环检测** | 新增/改端点后若能从后继走回前驱 → 400「会形成循环依赖」 |
| 类型 | 只允许 `FS / SS / FF / SF`（大小写不敏感，自动转大写） |
| 间隔 | `lag_hours` 0 ~ 8760（支持小数，保留 2 位） |

环检测实现：取该项目的全部依赖边做 BFS，判断 `successor → … → predecessor` 是否可达；`PUT` 改端点时会忽略当前这条边再判。

## 4. 界面（抽屉）

```
依赖维护（类型 / 间隔）
├─ 项目选择（默认跟随甘特图当前项目）+ 刷新
├─ 新增依赖：前驱 → 后继 + 类型(FS 完成-开始…) + 间隔(h) + 添加
│   └─ 类型语义提示：FS=前驱完成后后继才能开始（最常见）
└─ 依赖表：前驱工序 / 类型(下拉) / 间隔(数字) / 间隔展示 / 后继工序 / 保存·删除
```

- 类型下拉同时显示代码与中文语义（`FS 完成-开始`）；
- 间隔展示做换算：`0 → 无间隔`、`8 → 8 小时`、`24 → 1 天`、`36 → 1.5 天（36h）`；
- 保存后抽屉刷新，并通知甘特图重新加载依赖 → **箭头立刻按新间隔错开并把线变虚线**；
- 删除有二次确认。

## 5. 权限

| 操作 | 权限 |
|---|---|
| 读列表 | `process:read`（本次补上；之前 GET 没有规则，任何登录用户可读） |
| 增/改/删 | `process:write` **或** `equipment:write`（计划员/工长用 equipment:write 也能维护） |

## 6. 实测（生产）

- 列表：项目 1 共 **89 条依赖 / 156 个工序**，join 名称正常（如 下料 → 卷制/成型）；
- 改 lag：`PUT id=93 {lag_hours: 8}` → 200，再次 `0` 还原；
- 自依赖 / 重复 / 反向成环 / 非法类型 / 非法 lag → 全部 400 且提示明确；
- 单测：后端 `tests/processDependencies.test.js` **6/6**（列表、校验、环、成功、PUT 重校验、删除）；
  前端 `tests/domain/dependencyAdmin.test.ts` **5/5**（类型文案、lag 展示、草稿校验、下拉文案）。

## 7. 已知边界

1. **类型只影响语义展示**：甘特图的 lag 偏移目前只对 `FS` 生效，SS/FF/SF 的几何偏移暂未实现（箭头仍按"前驱结束→后继开始"画）；
2. 间隔只支持小时（不支持"工作日/日历日"区分）；
3. 不支持批量导入依赖（逐条新增；如需要可从工艺模板生成）。
