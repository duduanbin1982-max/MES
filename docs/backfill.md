# 数据补录工具（P0-B，2026-10-18）

功能建好了但"没数据"的三处，用这个工具接上真实数据：

| 缺口 | 现状 | 补录后能做什么 |
|---|---|---|
| `instance_bom.material_lot_id` | 0 / 79 | 设计 BOM ↔ 实装批次对账；追溯链 L4 真正可达 |
| `serial_numbers` | 0 行 | 单件追溯（从序列号反查工单/批次/检验） |
| `oee_shift_log` 三层基线 | 117 个 legacy | OEE 口径校验从"3/120"变成全量 |

## 一、流程（四步）

```bash
# 1) 生成模板（从生产库导出，按当前数据预填）
node scripts/gen-backfill-templates.js
#    → data/backfill/templates/{bom-lots,serials,oee-shifts}.csv

# 2) 业务填 CSV（Excel 直接打开；不要改表头/列顺序；空行会忽略）

# 3) 先 dry-run 看"将改什么"（不写库）
node scripts/data-backfill.js --type=bom-lots --csv=data/backfill/templates/bom-lots.csv

# 4) 确认无误再写库（写前会检查最近备份是否 <6 小时）
node scripts/data-backfill.js --type=bom-lots --csv=data/backfill/templates/bom-lots.csv --apply
```

补录后跑一次校验（前后对比）：

```bash
node scripts/trace-chain-audit.js          # 链路填充率 / 覆盖率
node scripts/oee-recompute-check.js --days=365   # OEE 口径一致率
```

## 二、三类 CSV 模板

### 1) `bom-lots.csv` —— 设计 BOM ↔ 实装批次

| 列 | 必填 | 说明 |
|---|---|---|
| `instance_code` | ✅ | 装备编码（如 `TBM-2026-001`） |
| `part_number` | ✅ | BOM 行零件号（必须是 `instance_bom.part_number` 已存在的值） |
| `lot_no` | 二选一 | 批次号（`material_lots.lot_no`）；批次物料须与 BOM 物料一致 |
| `serial_no` | 二选一 | 序列号（需先用 `serials.csv` 建档） |

### 2) `serials.csv` —— 序列号建档

| 列 | 必填 | 说明 |
|---|---|---|
| `serial_no` | ✅ | 唯一序列号 |
| `lot_no` | 建议 | 所属批次 |
| `instance_code` | 建议 | 装机装备 |
| `work_order_code` | 可选 | 装配工单 |
| `status` | 可选 | 默认 `in_stock` |

### 3) `oee-shifts.csv` —— 三层时间基线

| 列 | 说明 |
|---|---|
| `shift_id` | 班次 id（模板已给，**不要改**） |
| `shift_minutes` | 班次总时长（模板已预填 = planned_minutes） |
| `planned_stop_minutes` | 计划停机（保养/点检/计划检修/节假日） |
| `fault_minutes` / `changeover_minutes` / `material_wait_minutes` | 可用率损失三拆分，**合计应等于模板里的 `suggested_availability_loss`**（= planned − operating） |
| `idle_minutes` | 性能损失（短停/空转/降速折算分钟） |

> 填完后 `oee_shift_log` 才有完整基线；`scripts/oee-recompute-check.js` 的"可校验班次"会随之上升。

## 三、安全与回滚

- 默认 **dry-run**，只打印计划；`--apply` 才写库
- 每批生成边车记录 `data/backfill/batch-<时间戳>-<类型>.json`，记录**每个字段的旧值**
- 回滚一条命令：`node scripts/data-backfill.js --rollback=data/backfill/batch-xxx.json`
  （INSERT 会按 rowId 删除；UPDATE 还原旧值；重复回滚幂等）
- 写库前检查最近备份年龄 >6h 会拒绝（先跑 `scripts/backup-db.sh`，或 `--force`）
- 已填过值的行默认跳过；覆盖需显式 `--overwrite`
- 批次物料与 BOM 物料不一致会报错；确认无误可加 `--allow-material-mismatch`

## 四、常见错误

| 报错 | 原因 / 处理 |
|---|---|
| `BOM 行不存在` | `part_number` 与库里的不一致（用模板里的原值） |
| `批次号不存在` | 先在物料/批次模块登记该批次 |
| `批次物料与 BOM 物料不一致` | 批次挂错物料，或该行本来就是替代料（确认后加开关） |
| `序列号不存在` | 先用 `--type=serials` 建档，再关联 BOM |
| `最近备份已 x.xh 前` | 先备份：`bash scripts/backup-db.sh` |
