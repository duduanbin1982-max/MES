# 项目排程（/schedule）模块审计报告

> 审计对象：factory-mes 自研「项目排程」模块（含 **与单项目甘特 / 多项目资源平衡的边界**）  
> 审计日期：2026-11-05  
> 审计方式：代码走读（前端 1062 行 + 甘特组件 954 行 + composable 262 行 + 后端 schedule 路由/重排程）+ 生产接口实测（周窗口 / 甘特 / 批次 / 状态）+ 权限与数据核对  
> 生产数据：5 个项目、170 个工序节点、89 条依赖、123 个节点已批量平移至 2026-11-10

## 0. 结论摘要

**总体评级：C+（页面信息量大，但"本周"窗口算错、KPI 口径失真、三条改期路径保障不一致）**  
**整改后：A（3 个 P1 + 2 个 P2 + 4 项 P2/P3 已全部修完，含生产里程碑数据治理）**

| 维度 | 评价 | 说明 |
|---|---|---|
| 周窗口正确性 | **差** | 前后端各用一次 `toISOString()`，东八区下"本周"实际偏移约一周 |
| KPI 口径 | **差** | 接口返回整个 backlog，"完成率/项目进度"据此计算 → 完成率 0%、进度 0% |
| 写路径一致性 | **差** | 拖拽改期不记批次、不可撤销、不校依赖；批量平移/重算排程都有批次 |
| 状态机 | 中 | 工序状态任意互转（已完成可回退成进行中），实际时间与状态自相矛盾 |
| 里程碑 | 中 | 无确认、无状态校验；实际日期用 UTC（早 8 点会记成昨天） |
| 与单项目甘特边界 | **不清** | 两页都能改计划时间，但保障/能力不同，无交叉入口与说明 |
| 性能 | 好 | 周查询 / 甘特 / 批次 均在 10~30ms |
| 测试 | 中 | 甘特+批量重排程有测试；周窗口/状态/里程碑无行为测试 |

---

## 1. 模块结构

### 1.1 前端

| 文件 | 作用 | 行数 |
|---|---|---|
| `frontend/src/views/Schedule.vue` | 页面：3 个 tab（本周任务 / 项目里程碑 / 甘特图）+ 分配弹窗 + 批量重排程弹窗 + 批次抽屉 | 1062 |
| `frontend/src/views/schedule/GanttChart.vue` | 跨项目甘特（自绘 CSS/SVG，依赖箭头、N 跳展开、拖拽改期） | 954 |
| `frontend/src/views/schedule/DependencyAdminDrawer.vue` | 依赖维护（类型 / 间隔 CRUD） | 314 |
| `frontend/src/composables/useSchedulePage.ts` | 周数据、里程碑、派工、状态动作、批次 | 262 |
| `frontend/src/domain/scheduleBoard.ts` | 周看板纯函数（异常/超期/分组/周重叠） | 233 |

### 1.2 后端

| 文件 | 作用 |
|---|---|
| `services/schedule/routes/routes_1.js` | `GET /schedule/weekly`、`PUT /schedule/process-nodes/:id/assign` |
| `services/schedule/routes/routes_2.js` | `PUT /schedule/process-nodes/:id/status`、capacity、daily、my-tasks |
| `services/schedule/routes/routes_gantt.js` | `GET /schedule/gantt`、`PUT /schedule/process-nodes/:id/dates` |
| `services/schedule/reschedule.js` | 批量平移（preview / apply / batches / undo） |
| `services/process/node/dependencies.js` | 依赖 CRUD（依赖维护抽屉） |
| `services/reportService/milestones.js` | 里程碑列表 / 自动生成 / 更新 |

---

## 2. 与单项目甘特的边界（重点）

### 2.1 三页能力对照

| 维度 | `/schedule` 项目排程 | `/gantt` 单项目甘特 | `/multi-schedule` 资源平衡 |
|---|---|---|---|
| 定位 | **作业执行层**：本周干什么、谁干、状态如何 | **单项目计划层**：依赖链、实际进度、重算 | **产能层**：工位够不够、谁抢谁 |
| 视角 | 跨项目（可筛项目） | 单项目 | 跨项目（工位维） |
| 主视图 | 本周任务看板 + 里程碑 + 跨项目甘特 | 单项目甘特（依赖箭头 / N 跳 / 实际进度） | 工位×日热力图 + 冲突表 |
| 改期方式 | ① 批量平移（按实例/子系统/超期，记 RS 批次）② 甘特拖拽（记 **DT 批次**，整改后） | 重新排程（算法重算，记 SC 批次，跳完成） | 不改期（只改工位归属） |
| 依赖维护 | ✅ 抽屉（FS/SS/FF/SF + lag） | 只读箭头（不支持编辑） | — |
| 实际进度 | 只显示状态 | ✅ 计划 vs 实际、项目进度、实际开始标记 | — |
| 告警 | 周看板异常（超期/受阻/未排程） | ✅ 本项目告警（超期/受阻/未排程/里程碑/长运行工单） | 产能冲突 |
| 撤销 | 批次抽屉可撤销 RS/DT/SC | 排程/改期后顶部可撤销 | — |

### 2.2 边界问题与整改

| 问题 | 说明 | 整改 |
|---|---|---|
| 同一字段（`planned_start/end`）三条写路径 | 批量平移有批次+撤销；重算排程有预览+批次+撤销；**拖拽改期什么都没有** | 拖拽改期补 `DT-` 批次 + 依赖破环告警 + 批次抽屉可撤销 |
| 两页甘特职责重叠 | `/schedule` 有跨项目甘特+依赖维护；`/gantt` 有单项目深度视图，互不相关也无入口 | 两页头部互加跳转入口；新增 `docs/schedule-vs-gantt.md` 说明分工 |
| 依赖维护只在 `/schedule` | 在 `/gantt` 里看不到依赖维护 | 文档说明；后续可把抽屉抽成共享组件 |
| 未排程节点的处理 | `/schedule` 周看板把它们列为异常；`/gantt` 用虚线推算条；`/multi-schedule` 默认排除 | 各自口径在文档中写明 |

**推荐使用路径**：
1. 周一排产 / 看本周该干什么 → `/schedule`「本周任务」
2. 计划整体偏移（如甲方延期）→ `/schedule`「批量重排程」（平移，保留工期）
3. 依赖或起始日变了、要按约束重算 → `/gantt`「重新排程」（预览后应用，可撤销）
4. 工位撞车 / 产能不够 → `/multi-schedule`（看冲突、改派工位）

---

## 3. 发现清单

| 编号 | 级别 | 问题 | 影响 |
|---|---|---|---|
| F-01 | **P1** | 周窗口时区错位（前端 `toISOString` + 后端 `toISOString`） | "本周"实际偏移最长约一周；日期筛选不可信 |
| F-02 | **P1** | `GET /schedule/weekly` 返回全部未完成节点（backlog） | 完成率/项目进度按 backlog 算 → 0%；"本周任务"表格列出全项目任务 |
| F-03 | **P1** | 拖拽改期无批次/无撤销/无依赖校验 | 计划时间被改后无法追溯；可能破坏依赖链且无提示 |
| F-04 | P2 | 工序状态任意互转（已完成→进行中） | `status` 与 `actual_end` 矛盾，统计口径脏 |
| F-05 | P2 | 里程碑无确认、无状态校验、UTC 日期 | 可跳过"进行中"直接完成；早 8 点实际操作记成昨天 |
| F-06 | P2 | 派工无资质校验 | 与 `/process_nodes/:id/assign`（有 validateAssignment）不一致 |
| F-07 | P2 | 与单项目甘特能力重叠且无交叉入口 | 用户不知道去哪个页面做重算/依赖分析 |
| F-08 | P3 | 日期格式不统一（`T` 分隔 vs 空格；`normalizeDate` 直接 `slice(0,19)`） | 跨模块比较/显示不一致 |
| F-09 | P3 | 里程碑 `planned_end` 普遍为空（10 条里 9 条只有 planned_start） | 里程碑延期无法判定 |
| F-10 | P3 | 周看板无行内改期；批量重排程入口与 tab 无关联提示 | 操作路径不够顺 |

---

## 4. 关键证据（整改前）

### F-01 周窗口

```
GET /api/schedule/weekly?date=2026-11-05   （周四）
→ week_start=2026-11-01（周日）, week_end=2026-11-07（周六）    应为 11-02 ~ 11-08
```

前端 `loadWeekly` 还先把 Date 用 `toISOString()` 变成 `2026-11-01` 再传给后端，后端再按 UTC 算一次 → 双重偏移。

### F-02 KPI 口径

```
summary: total=87, completed=0, in_progress=4, pending=83
其中与本周重叠: 0 条
各项目 progress_pct: TBM-2026-001: 0%（87 条）
```

页面因此显示"本周计划 0 条 / 完成率 0%"，但表格里却有 87 行（全是 backlog）。

### F-03 三条写路径

| 路径 | 批次 | 可撤销 | 依赖校验 | 预览 |
|---|---|---|---|---|
| 批量重排程 | RS-… | ✅ | — | ✅ |
| 重算排程（/gantt） | SC-… | ✅ | ✅ 环检测 | ✅ |
| 拖拽改期（/schedule） | ❌ | ❌ | ❌ | ❌ |

---

## 5. 整改记录（2026-11-05 当天）

### 5.1 P1

| 项 | 整改 | 验证 |
|---|---|---|
| F-01 | 后端周计算改为本地日期格式化（`formatLocalDate`）；前端 `loadWeekly` 也传本地日期 | 单测 WEEK.1/2：`2026-11-05 → 11-02~11-08`；周日/周一输入同归一 |
| F-02 | weekly 只返回「本周重叠 + 未排程」，新增 `scope: 'week+unscheduled'`、`summary.unscheduled`；项目 `progress_pct` 按本周范围算 | 单测 WEEK.3/4；生产：11-02 周 39 条（全为未排程），11-10 周 161 条（122 本周 + 39 未排程） |
| F-03 | 拖拽改期写 `DT-YYYYMMDD-NNN` 批次（含旧/新快照），返回 `batch_no` + `warnings`（前驱结束晚于新开始 / 后继开始早于新结束，只告警不阻断）；前端提示批次号与告警、刷新批次列表 | 单测 SG.4/SG.6；生产实测：挪 141→142 的前驱链，返回 `DT-20261105-001` + 告警"前驱焊接计划结束 2026-11-11 04:00 晚于新开始 2026-11-02"，批次撤销成功后时间还原 |

### 5.2 P2

| 项 | 整改 | 验证 |
|---|---|---|
| F-04 | 状态流转表：允许 `pending/ready/paused/blocked/delayed → completed`（短任务直接报完工），**禁止 completed 回退**，同状态幂等返回 `unchanged`，完成时补 actual_start/actual_end | 单测 ST.1~ST.5 |
| F-05 | 里程碑：前端二次确认；后端状态转移 `pending→active→completed`（禁止跳级/回退），`active` 自动补本地 actual_start、`completed` 自动补本地 actual_end | 单测 MS.1~MS.5 |
| F-07 | 两页互加跳转入口（`/schedule` 甘特 tab → 单项目甘特；`/gantt` → 多项目排程）；新增边界文档 `docs/schedule-vs-gantt.md` | 构建产物包含入口；文档入库 |



### 5.4 第二轮整改（同日）：P2/P3 清零

| 项 | 整改内容 | 验证 |
|---|---|---|
| **F-06** 派工资质校验 | 新增 `shared/assignmentValidation.js`（技能等级 / 资质证书 / 必需文档签收）；`services/processMaster/assignment.js` 改为复用同一实现；`PUT /schedule/process-nodes/:id/assign` 派工前校验，不满足返回 400 + `missing` 明细，`force=true` 可强制（仍返回校验结果）；前端派工弹窗加「无资质强制派工」勾选并展示缺失项 | 单测 AV.1~AV.6 6/6；生产实测：给需要 `cutting` 的 #135 派无技能人员 → `400 缺少 cutting L1+ 技能`（未写库）；force 路径单测通过 |
| **F-08** 时间格式统一 | 新增 `shared/datetime.js`：`formatSqlDate / formatSqlDateTime / nowSqlDateTime / normalizeSqlDateTime`；排程状态写入改本地 `'YYYY-MM-DD HH:MM:SS'`（原 `toISOString().slice(0,19)` 带 T 且是 UTC）；`normalizeDate` 兼容 ISO 带 T/Z/毫秒并归一；reschedule 的日期计算改本地日期 | 单测 DT.1~DT.4 4/4（含"状态接口写入不带 T"回归）；生产库当前 0 条 T 格式脏数据，后续写入统一 |
| **F-09** 里程碑计划数据治理 | 新增 `POST /api/equipment_instances/:id/milestones/backfill`（支持 `?dryRun=1`）：未完成里程碑按阶段权重重新规划、已完成保留原计划（仅缺 end 补 end）；前端里程碑页加「补齐计划日期（N 条）」+ 每行「计划」编辑弹窗 | 单测 MSB.1~MSB.4 4/4；**生产数据已执行**：28/44 条缺计划 → **0/44**；实例 1 的 S1~S10 变为 2026-07-01 ~ 2026-12-29 顺序不重叠 |
| **F-10** 周看板行内改期 + 入口引导 | 周看板行下拉新增「只改计划时间」→ 弹窗改 `planned_start/end`（走 `PUT /schedule/process-nodes/:id/dates`，自动记 DT 批次、返回依赖告警）；本周无计划且有未排程/超期时，看板顶部出现引导条：「去单项目甘特重算」「批量平移」 | 构建通过；产物含「补齐计划日期」「只改计划时间」 |

**整改后评级：C+ → A**（P1/P2/P3 全部清零；剩余为数据治理习惯与后续增强）。

**仍未做（增强项，非缺陷）**：
- 历史日期格式统一只在写入侧收口，若发现外部导入的 `T` 格式可再跑一次数据清洗；
- 派工资质校验已共用，但 `force` 强制派工目前只提示、未落审计日志表（可在后续接入审计）。

### 5.5 未整改（增强项，非缺陷）

- 派工「强制派工」建议后续写审计日志（当前只在响应里返回校验结果）；
- 若外部系统导入带 `T/Z` 的时间字符串，可再跑一次数据清洗脚本（写入侧已收口）。

---

## 6. 测试与验证

| 项目 | 结果 |
|---|---|
| `tests/scheduleWeekly.test.js`（新） | 5/5（周窗口、周日/周一归一、范围、summary/进度、非法日期） |
| `tests/scheduleStatus.test.js`（新） | 5/5（合法流转、已完成回退禁止、直接完工补实际时间、幂等、进行中→完成） |
| `tests/milestoneTransitions.test.js`（新） | 5/5（本地日期回填、禁止跳级、禁止回退、只改备注） |
| `tests/scheduleGantt.test.js` | 6/6（新增 SG.4 批次断言、SG.6 依赖告警） |
| `tests/scheduleSplit.test.js` | 5/5（含派工→产能→完成全链路） |
| 前端 domain | 119/119 |
| eslint / vue-tsc / build | 0 / 0 / ok |
| 全量部署闸门 | **725/0** |
| 生产产物 | `Schedule-BT5Iy6Mr.js`、`Gantt-DYkY9DDz.js` |

## 7. 生产实测对照

| 场景 | 整改前 | 整改后 |
|---|---|---|
| `weekly?date=2026-11-05` | 11-01 ~ 11-07（周日~周六） | **11-02 ~ 11-08**（周一~周日） |
| 本周任务范围 | 全部未完成节点（87 条） | 本周重叠 + 未排程（11-02 周：39 条未排程；11-10 周：161 条） |
| 完成率/项目进度 | 按 backlog：0% | 按本周范围统计 |
| 拖拽改期 | 无批次、无撤销、无依赖提示 | `DT-…` 批次 + 依赖告警 + 可撤销（实测还原成功） |
| 已完成节点状态回退 | 允许（actual_end 残留） | 拒绝（400） |
| 里程碑直接完成 | 允许且记 UTC 日期 | 拒绝跳级；本地日期 + 二次确认 |
