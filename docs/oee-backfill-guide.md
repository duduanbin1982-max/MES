# OEE 三层基线补录指南（120 个班次，逐行填法）

> 目标：让 `/api/oee/overview/audit` 的"可校验班次"从 **3/120** 变成 **120/120**，
> 这样 OEE 的可用率/性能/质量才算"有据可查"，而不是拍脑袋。

## 一、这份文件是什么

`oee-shifts.csv` 每一行 = **一个班次**（白班/夜班各一行），共 120 行（2026-05-28 ~ 2026-06-26）。

系统里已经有：班次日期、班次名、计划生产分钟、实际运行分钟、产出、合格数、节拍。
缺的是：**这些分钟到底损失在哪**——计划停机？故障？换型？待料？短停？

## 二、千万不要改的列（改了会导致口径对不上）

| 列 | 含义 | 为什么不能改 |
|---|---|---|
| `shift_id` | 班次 id | 导入靠它定位行 |
| `shift_date` / `shift_name` | 日期 / 白夜班 | 同上 |
| `planned_minutes` | 计划生产分钟 | 可用率的分母 |
| `operating_minutes` | 实际运行分钟 | 可用率的分子 |
| `shift_minutes` | 班次总时长 | 已按 planned 预填 |
| `ideal_cycle_time` / `total_output` / `good_output` | 节拍 / 产出 / 合格数 | 性能与质量的计算依据 |
| `suggested_availability_loss` | 建议的损失合计 = planned − operating | **只读参考，不参与导入** |

## 三、要填的 6 列

| 列 | 填什么 | 单位 |
|---|---|---|
| `planned_stop_minutes` | 计划停机：保养、点检、计划检修、节假日 | 分钟 |
| `fault_minutes` | 故障停机：设备故障、液压/电气故障 | 分钟 |
| `changeover_minutes` | 换型调试：换刀/换模具/调机/首件试切 | 分钟 |
| `material_wait_minutes` | 待料/空转：等物料、等上道工序、等图纸 | 分钟 |
| `idle_minutes` | 性能损失：短停（<5min）、空转、降速折算成分钟 | 分钟 |

### 唯一的硬规则

```
fault_minutes + changeover_minutes + material_wait_minutes  =  suggested_availability_loss（±0.01）
```

`idle_minutes` 是**独立**的（性能损失），不参与上面这个等式。

> 如果三个损失加起来 ≠ 建议值，审计会把这个班次标成"口径不一致（mismatch）"，
> 反而比不填更糟。**宁可留空（=不修改），也不要随便凑数。**

## 四、三种典型场景（照抄格式即可）

### 场景 A：损失大（> 60 分钟）+ 有计划停机

```
shift#1  2026-06-26 白班 | planned 480 / operating 408.1 | suggested 71.9
planned_stop_minutes = 30          ← 早上做保养
fault_minutes        = 39.55       ← 71.9 × 55%
changeover_minutes   = 21.57       ← 71.9 × 30%
material_wait_minutes= 10.78       ← 71.9 × 15%（用减法凑齐）
idle_minutes         = 18          ← 另有 18 分钟短停/空转（交接班记录里有）
```

### 场景 B：损失中等（25~60 分钟）+ 无计划停机

```
shift#4  2026-06-26 夜班 | planned 420 / operating 361 | suggested 59
planned_stop_minutes = 0
fault_minutes        = 41.3        ← 59 × 70%
changeover_minutes   = 11.8        ← 59 × 20%
material_wait_minutes= 5.9         ← 59 × 10%
idle_minutes         = 6
```

### 场景 C：损失小（< 25 分钟）

```
shift#46 2026-06-15 夜班 | planned 420 / operating 397.4 | suggested 22.6
planned_stop_minutes = 0
fault_minutes        = 11.3        ← 50%
changeover_minutes   = 6.78        ← 30%
material_wait_minutes= 4.52        ← 20%
idle_minutes         = 0           ← 无短停记录就填 0
```

以上三行已放在 `oee-shifts-EXAMPLE.csv`，可直接对照。

## 五、数据从哪来

| 损失类型 | 记录来源 |
|---|---|
| 计划停机 | 设备保养计划、点检表、检修工单 |
| 故障停机 | 设备维修单、报修记录、MES 异常中心 |
| 换型调试 | 交接班记录、换型记录（换刀/换模时间） |
| 待料/空转 | 领料记录、齐套检查、异常中心"缺料"类 |
| 短停/性能损失 | 班组长交接班记录；没有就不填 |

**没有记录的班次怎么办？** 三种选择：
1. 按经验比例拆（故障 60% / 换型 25% / 待料 15%）—— 就是 `oee-shifts-suggested.csv` 里预填的值
2. 只填能确认的那一项（其余留空）—— 审计会标 mismatch，但至少知道"哪部分有据"
3. 留空 —— 审计保持 legacy，不产生假数据

## 六、导入与校验

```bash
# 1) dry-run：看"将写入 N 处变更 / 跳过 / 错误"
node scripts/data-backfill.js --type=oee-shifts --csv=data/backfill/templates/oee-shifts.csv

# 2) 正式导入（写前会检查最近备份 < 6 小时）
node scripts/data-backfill.js --type=oee-shifts --csv=data/backfill/templates/oee-shifts.csv --apply

# 3) 校验：两种口径重算 + 一致率
node scripts/oee-recompute-check.js --days=365

# 4) 页面/接口看分级
curl -H "Authorization: Bearer <token>"   "http://127.0.0.1:3890/api/oee/overview/audit?days=365"
```

导入后预期：`可校验班次 3 → 120`、`legacy 117 → 0`、`pass_rate 100%`（前提是三项合计对得上）。

出错时可回滚：`node scripts/data-backfill.js --rollback=data/backfill/batch-<时间戳>-oee-shifts.json`

## 七、常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 三项合计 ≠ suggested | 手算误差/漏填 | 用减法补齐第三项（如示例里的 material_wait） |
| 审计出现 mismatch | 合计对不上，或计划停机被填进 fault | 计划停机只填 `planned_stop_minutes` |
| `idle_minutes` 填得很大 | 把"整班停机"填进性能损失 | 性能损失只放短停/空转/降速；大段停机放 fault |
| 日期格式报错 | Excel 存成别格式 | 支持 `2026-10-15` / `2026/10/15`，其它格式报行号 |
| 中文乱码 | 文件编码 | 系统自动识别 GBK/UTF-8，无需转换 |
| 导入后 OEE 变低 | 正常：原来性能/质量被高估 | 对比 `oee-recompute-check` 前后两张表 |

## 八、两条路，选一条

**路线 1（省事，推荐先试）**：`oee-shifts-suggested.csv` —— 120 行已按 60/25/15 预填，
业务逐行核对"这个比例合不合理"，改动少数明显不符的行，然后导入。

**路线 2（严谨）**：从空白模板 `oee-shifts.csv` 出发，按班组长交接班记录逐行填（约 2~4 小时）。

> 建议：先按路线 1 导入，把 120 行变成"可校验"；后续每次月结再按真实记录修正
> （`--apply` 会覆盖旧值，边车记录可回滚）。
