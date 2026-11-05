# OEE / 质检 / 项目装备 模块审计报告

> 审计对象：`/oee`（OEE 深度分析）、`/quality`（质检管理）、`/instances`（项目装备列表与详情）  
> 审计日期：2026-11-05  
> 审计方式：代码走读（OEE 后端 815 行 + QC 430 行 + 前端 1134 行）+ 生产接口实测 + 权限矩阵验证 + 数据核对  
> 生产数据：`oee_shift_log` 120 条（2026-05-28 ~ 06-26）、`oee_loss_events` 240 条、质检记录 5 条、NCR 5 条、CAPA 2 条

## 0. 结论摘要

**总体评级：C+（OEE 数字口径错位最严重；质检口径缺说明；项目装备操作按钮无权限门控）**  
**整改后：A-（3 个 P1 + 4 个 P2 已修）**

| 模块 | 评级 | 关键问题 |
|---|---|---|
| OEE | **C** | 主视图统计的是「未来 N 天」，字段却叫利用率；跨天任务 busy 按日历小时 ×24 严重高估；可用工时固定 24h/天，与资源平衡页口径不一致 |
| 质检 | B- | 概览（近 30 天）与列表（历史累计）两套口径无说明；深链无路由权限守卫 |
| 项目装备 | B | 详情页「重算进度 / 冻结 / 归档」按钮无权限门控，计划员点了才 403；错误提示取 `error.message` 而非后端 message |

---

## 1. OEE 模块

### 1.1 现状与数据

- 主 tab（工位概览）调用 `GET /api/equipment/oee`（`services/equipment/oee.js`）；
- ISA-95 tab 调用 `GET /api/oee/overview`（`services/oee/overview.js`，基于 `oee_shift_log` 班次数据）；
- 损失分析 / 班组对比 / 趋势分别调用 `/oee/loss-events`、`/oee/shift-comparison`、`/oee/trend`（均需选项目）。

### 1.2 发现

| 编号 | 级别 | 问题 | 证据 |
|---|---|---|---|
| OEE-1 | **P1** | 统计窗口方向错误：从「今天」往后算 N 天，统计的是未来计划，不是历史绩效 | 实测 `start_date=2026-11-05, end_date=2026-12-05`（今天 11-05）；字段仍叫"车队利用率" |
| OEE-2 | **P1** | busy 工时按「日历重叠天数 × 24h」计算，跨天任务被严重高估 | 4h 任务跨 2 天会被算成 48h；长任务（如 8h 跨 48h）虚增 6 倍 |
| OEE-3 | **P1** | 可用工时固定 24h/天 × 工位数，忽略班次与并行人数 | 与 `/multi-schedule` 的 `daily_capacity_hours`（班次×人数，封顶 24）口径不一致，同一工位两页利用率差异可达 3 倍 |
| OEE-4 | P2 | 主 tab 与 ISA-95 tab 数据源/窗口不同（工单 vs 班次、未来 vs 过去），空窗口无提示 | `/oee/overview?days=30` 返回 `shifts=0`（数据在 2026-05~06），页面空白无解释 |
| OEE-5 | P2 | 损失/班组/趋势 tab 未选项目时静默空表 | composable 里 `if (!instance_id) return`，无提示 |

### 1.3 整改

| 项 | 整改 | 验证 |
|---|---|---|
| OEE-1 | 默认窗口改为**近 N 天**（含今天），保留 `?start_date=` 回看历史；响应带 `window.mode`（past/explicit）与 `start_date/end_date` | 单测 OEE.5/OEE.6；实测 `2026-10-07 ~ 2026-11-06` |
| OEE-2 | busy = 任务工时 × 窗口重叠比例（工时优先 `estimated_hours`，缺失用跨度） | 单测 OEE.3：8h 任务跨 48h → busy=8h（原 48h） |
| OEE-3 | 新增 `shared/capacity.js`（班次×人数，封顶 24h），OEE 与资源平衡共用；工位响应带 `daily_capacity_hours` | 单测 OEE.1/OEE.2/OEE.4；实测 9 工位 30 天可用 3120h（含双班/多人工位） |
| OEE-4 | `/oee/overview` 返回 `data_range`（首个/最近班次日期）+ `hint`；OEE 页加「起始日」选择器与空窗口提示；ISA-95 tab 无班次时提示"退化为工单估算" | 实测 `latest_shift_date=2026-06-26` + hint；近 180 天班次 120 条、OEE 84.18%（A） |
| OEE-5 | OEE 页空窗口提示改用 `data_range`（最近任务时间），引导调整起始日/天数 | 构建通过 |

---

## 2. 质检模块

### 2.1 发现

| 编号 | 级别 | 问题 | 证据 |
|---|---|---|---|
| QC-1 | P2 | 概览指标（近 30 天）与列表（历史累计）口径无说明，同一页数字对不上 | `/qc/dashboard` 通过率 100%（近 30 天 1 条）vs `/qc/stats` 80%（5 条累计） |
| QC-2 | P2 | 深链无路由权限守卫；`worker` 有 `quality:read` 但缺 `equipment:read/work_order:read`，页面部分下拉 403 | 角色权限矩阵实测 |
| QC-3 | P3 | NCR/CAPA 状态流转、超期计算分散在 dashboard，无文档 | 代码走读 |

### 2.2 整改

- QC-1：质检页顶部加口径说明（概览近 30 天 / 列表历史累计）；
- QC-2：`/quality` 路由加 `requires: 'quality:read'`（与菜单、接口权限对齐）；
- 剩余：worker 打开质检页时实例下拉 403 的友好提示未做（P3，可后续按需加）。

---

## 3. 项目装备（/instances）

### 3.1 发现

| 编号 | 级别 | 问题 |
|---|---|---|
| INST-1 | P2 | 详情页「重算进度 / 冻结基线 / 归档」按钮无权限门控，无权限用户点击才 403 |
| INST-2 | P2 | 这些操作的错误提示取 `error.message`（axios 通用文案），不显示后端 `message` |
| INST-3 | P3 | 列表无分页/排序/导出；无删除（用归档代替） |

### 3.2 整改

- INST-1：详情页按 `equipment:write` 门控三个按钮（禁用 + title 说明），避免 403；
- INST-2：错误提示优先取 `error.response.data.message`；
- INST-3：记录为 P3，未做。

---

## 4. 测试与验证

| 项目 | 结果 |
|---|---|
| `tests/oee.test.js`（重写） | **6/6**（空工位可用工时、单日 busy、跨天摊销、双班×人数、默认近 N 天、显式历史窗口） |
| `tests/oeeIsa95.test.js` / `qcService.test.js` | 既有测试通过（响应新增字段为向后兼容） |
| 前端 domain / eslint / vue-tsc / build | 119/119 / 0 / 0 / ok |
| 全量部署闸门 | **755/0** |
| 生产实测 | OEE 窗口 2026-10-07~11-06（past）、容量口径 `shift_workers`、可用 3120h；ISA-95 近 180 天 120 班次 OEE 84.18%（A）；空窗口 hint 指向最近班次 2026-06-26 |

## 5. 未整改（P3）

1. 质检页在 `worker` 角色下实例/工单下拉 403 的友好提示与降级；
2. 项目装备列表分页/排序/导出；
3. OEE 损失/班组/趋势 tab 未选项目时仍为空表（已有选择器，提示可再加）；
4. OEE 完整 A×P×Q 仍依赖班次记录（`oee_shift_log`），历史窗口（2026-05~06）之外无数据。
