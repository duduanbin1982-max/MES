# 端到端验收（TBM-DEMO-001）

> 脚本：`scripts/acceptance-e2e.js`  
> 最近一次验收：**2026-11-05 通过（8/8 步、39/39 项检查）**，报告见 `logs/acceptance/e2e-<ts>.json|md`

## 1. 能验什么

覆盖一条完整链路（全部走真实 HTTP API，等价现场点击）：

| 步骤 | 验证内容 | 自动核对项 |
|---|---|---|
| 1 项目 | 演练项目可读取、有生命周期状态 | 2 |
| 2 里程碑 | 计划起止完整（缺则自动补齐）、按阶段递增、可推进（active→completed） | 5 |
| 3 工序计划 | 建 4 道工序（下料/卷制/焊接/检验）+ 3 条 FS 依赖；工序树可读 | 4 |
| 4 排程 | dryRun 预演 → 应用；批次号；全部工序有日期；**FS 顺序满足**；拖拽改期返回批次/告警 | 8 |
| 5 工单 | 创建并**关联工序**；派工→开工→报工；达标自动完工；数量一致 | 8 |
| 6 质检 | 创建检验记录、按工单查回、统计递增、看板可读 | 4 |
| 7 OEE | 补录 2 个班次 → ISA-95 读到班次、可用率/OEE 在合理区间；主视图口径=班次×人数、显式历史窗口 | 6 |
| 8 资源平衡 | 演练项目任务出现在 `/resources/gantt` 窗口内 | 2 |

## 2. 怎么跑

```bash
# 服务已在 127.0.0.1:3890 运行
node scripts/acceptance-e2e.js              # 跑一遍，结束后清理本次创建的数据（保留里程碑）
node scripts/acceptance-e2e.js --reset      # 先清演练项目的工序/依赖/工单/质检/班次再跑
node scripts/acceptance-e2e.js --keep       # 保留数据（可用于演示）
node scripts/acceptance-e2e.js --instance-code=TBM-DEMO-001 --base-url=http://127.0.0.1:3890
```

npm 快捷方式：`npm run acceptance:e2e` / `npm run acceptance:e2e:reset` / `npm run acceptance:e2e:keep`

- 只操作演练项目（默认 `TBM-DEMO-001`），不会碰真实项目；
- `--reset` 会清掉该项目的工序/依赖/工单/质检/班次（**里程碑保留**）；
- 报告写入 `logs/acceptance/e2e-<ts>.json`（机器可读）和 `.md`（人可读）。

## 3. 自动核对清单（39 项）

| 阶段 | 关键断言 |
|---|---|
| 项目 | 项目存在；生命周期字段非空 |
| 里程碑 | ≥1 条；全部有计划起止；按阶段递增；可推进且状态正确 |
| 工序 | 4 道创建成功；3 条依赖创建成功；工序树 flat=4、deps=3 |
| 排程 | 预演无 errors 且 written=0；应用 written>0；批次 `SC-…`；4 道工序都有计划时间；后继开始 ≥ 前驱结束；拖拽返回 `DT-…` |
| 工单 | 工单 `process_node_id` 正确；派工后 `dispatched`；开工后 `in_progress`；报工后 `completed`；`quantity_completed == quantity_planned`；不超报 |
| 质检 | 记录创建；按 `work_order_id` 能查回；`/qc/stats.total` +1；`/qc/dashboard` 可读 |
| OEE | 2 个班次补录；`/oee/overview` shifts≥2；availability>0；0<OEE≤1；`capacity_basis=shift_workers`；`window.mode=explicit` |
| 资源 | 资源视图 items 含 `TBM-DEMO-001`；summary 正常 |
| 清理 | 默认清理本次创建的 4 工序/3 依赖/1 工单/1 质检/2 班次 |

## 4. 最近一次验收结果（2026-11-05）

```
✅ 1. 项目（TBM-DEMO-001）                       2/2
✅ 2. 里程碑（计划日期完整、可推进）              5/5
✅ 3. 工序计划（建 4 道工序 + 3 条 FS 依赖）      4/4
✅ 4. 排程（按依赖 + 工位生成计划时间）           8/8
✅ 5. 工单派工 / 开工 / 报工（关联工序）          8/8
✅ 6. 质检（检验记录 + 统计口径）                 4/4
✅ 7. OEE（补录班次 → 口径可算）                  6/6
✅ 8. 多项目资源平衡（演练数据可见）              2/2
=== 8/8 步、39/39 项检查通过 ===
```

关键数值：排程批次 `SC-20261105-001`、拖拽批次 `DT-20261105-002`、OEE 可用率 88.89% / OEE 85.33%、质检总数 5→6、资源视图 127 条任务。

## 5. 说明与边界

1. 验收脚本不替代人工业务验收（界面观感、打印、权限体验需人看）；
2. 演练项目当前是"培训演练机（可删除）"，脚本会创建并清理数据，**里程碑状态会被推进**（S1 从 active → completed），如需复位可在页面手工改回或重建演练项目；
3. OEE 第 7 步补录的班次在窗口内有效，默认跑完即清理；`--keep` 时保留可演示；
4. 脚本依赖服务已启动、`.env` 配置正常（JWT_SECRET）；CI/部署闸门**不自动跑**（会动演练数据）。
