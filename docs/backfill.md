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

#### 只填「现在就能生效」的行：`--only-linkable`

```bash
node scripts/gen-backfill-templates.js --type=bom-lots --only-linkable
# → data/backfill/templates/bom-lots-ready.csv（只含"该物料已有批次"的行，2026-10-18 实测 8/40 行）
```

模板第一列是 **`bom_id`**（BOM 行主键）。同一装备同一物料可能有多行（例如滚刀 12 件 / 1 件），
按 `material_code` 会歧义，**用 `bom_id` 就能精确对上**：

```csv
bom_id,instance_code,material_code,lot_no
12,TBM-2026-001,M-ST-Q345-40,LOT-20261015-01
15,TBM-2026-001,M-CUTTER-DISC,20261012-CD-01
17,TBM-2026-001,M-CUTTER-DISC,20261012-CD-01
```

### 2) `serials.csv` —— 序列号建档

| 列 | 必填 | 说明 |
|---|---|---|
| `serial_no` | ✅ | 唯一序列号 |
| `lot_no` | 建议 | 所属批次 |
| `instance_code` | 建议 | 装机装备 |
| `work_order_code` | 可选 | 装配工单 |
| `status` | 可选 | 默认 `in_stock` |

### 2.5) `lots.csv` —— 批次批量登记（B-2，推荐先做）

现网 `material_lots` 只有 3 条，`bom-lots` 大半行无批次可挂。先把批次登记进来：

| 列 | 必填 | 说明 |
|---|---|---|
| `material_code` | ✅ | 物料编码（`materials.material_code`） |
| `lot_no` | ✅ | 批次号（同物料下唯一；已存在会跳过） |
| `supplier` / `heat_no` / `certificate_no` | 建议 | 供应商 / 炉号 / 质保书号（追溯要用） |
| `received_date` | 可选 | `YYYY-MM-DD` |
| `quantity` / `unit` | 可选 | 到货数量（≥0）与单位 |
| `quality_status` | 可选 | 默认 `pending`（待检）；`pass` / `fail` |

```bash
node scripts/gen-backfill-templates.js --type=lots
node scripts/data-backfill.js --type=lots --csv=data/backfill/templates/lots.csv            # dry-run
node scripts/data-backfill.js --type=lots --csv=data/backfill/templates/lots.csv --apply
```

### 2.8) `cost-entries.csv` —— 成本台账（喂给 P2-2 三层差异 / 成本归集）

`project_cost_entries` 是项目实际成本的台账。原来只有 4 条人工成本，导致成本三层差异只能算出"380 元"。

| 列 | 必填 | 说明 |
|---|---|---|
| `instance_code` | ✅ | 装备编码 |
| `cost_type` | ✅ | **material / labor / outsourcing / depreciation / rework / quality_loss** |
| `amount` | ✅ | 金额（元，可为负数表示冲销） |
| `occurred_on` | ✅ | 发生日期（`2026-10-15` 或 `2026/10/15`） |
| `description` | 建议 | 摘要，空则自动生成"成本台账导入 {类型} {日期}" |
| `work_order_code` | 可选 | 关联工单（须已存在） |
| `vendor` | 可选 | 供应商 |
| `source_ref` | 强烈建议 | 来源单据号（采购单/外协单/折旧单）—— **去重键**，重复导入会自动跳过 |
| `notes` | 可选 | 备注 |

```bash
node scripts/gen-backfill-templates.js --type=cost-entries
# → cost-entries.csv（实例×6 类预填骨架，删掉不涉及的行）
# → cost-entries-EXAMPLE.csv（3 行已填示例，照抄格式）

node scripts/data-backfill.js --type=cost-entries --csv=...            # dry-run
node scripts/data-backfill.js --type=cost-entries --csv=... --apply
```

导入后：成本归集页的「三层差异」卡片会多出 **台账其他成本（外协/折旧/返工/质量损失）** 与
**台账核对**（台账金额 vs 按领料/工时计算的金额），能看出"账实差"。

> 注意：`cost_type` 有 CHECK 约束，只能是上面 6 类；填错会直接报错并指出行号。

### 3) `oee-shifts.csv` —— 三层时间基线

> 逐行填法（含三种典型场景与常见错误）见 [docs/oee-backfill-guide.md](oee-backfill-guide.md)。

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

## 三·四、`lots.csv` 怎么填（逐个字段说明）

**一句话**：一行 = **一次到货的一个批次**；同一个物料进 3 批就写 3 行，`lot_no` 不同。

先打开 `materials-reference.csv`（36 种物料 + 单位 + 是否关键件），在 `material_code` 列里挑编码。

| 列 | 填法 | 示例 | 说明 |
|---|---|---|---|
| `material_code` | 查 `materials-reference.csv` 第 1 列 | `M-ST-Q345-40` | 必须与库里一致；填错会报"物料编码不存在" |
| `lot_no` | 供应商批号，或自编 `LOT-YYYYMMDD-序号` | `LOT-20261015-01` | **同物料内唯一**；已存在会自动跳过（不报错） |
| `supplier` | 供应商简称 | `宝钢` | 追溯时要知道"谁供的" |
| `heat_no` | 炉号（钢材/铸件**必填**，从质保书抄） | `H-20261015-3` | 同一炉号可能是多个批次，追溯靠它 |
| `certificate_no` | 质保书/材质证明编号 | `GB/T 3274-20261015` | 客户审核时能出示证明 |
| `received_date` | 到货日期 | `2026-10-15` | 必须 `YYYY-MM-DD`（Excel 里先设成"文本"列） |
| `quantity` | 到货数量 | `12.5` | 不能为负；可留空 |
| `unit` | 计量单位 | `t` / `件` / `套` / `m` / `kg` | 建议与该物料的 `unit` 一致（见参考表） |
| `quality_status` | 检验状态 | `pending` | `pending` 待检 / `pass` 合格 / `fail` 不合格；默认 `pending` |
| `notes` | 用途/库位/备注 | `前盾下料用` | 可留空 |

### 照抄示例（`lots-EXAMPLE.csv`，已实测可导入）

```csv
material_code,lot_no,supplier,heat_no,certificate_no,received_date,quantity,unit,quality_status,notes
M-ST-Q345-40,LOT-20261015-01,宝钢,H-20261015-3,GB/T 3274-20261015,2026-10-15,12.5,t,pass,前盾下料用
M-ST-Q345-40,LOT-20261015-02,宝钢,H-20261016-1,GB/T 3274-20261016,2026-10-16,8.2,t,pass,同上，第二批
M-CUTTER-DISC,20261012-CD-01,洛阳轴承,HEAT-77821,ZZ-2026-1012,2026-10-12,4,件,pending,滚刀到货待检
M-BOLT-M20-10,20261013-BM-01,晋亿,HEAT-99012,BM-2026-1013,2026-10-13,500,件,pass,
```

### 编码与日期（2026-10-18 兼容增强）

- **编码自动识别**：Excel 中文环境「另存为 CSV」默认是 **GBK/GB18030**，导入器会先按 UTF-8 严格解码，
  失败则自动按 GBK 读取并提示"检测到 GBK 编码，已自动转换"，**中文不会乱码**
- **日期自动归一**：`2026-10-15`、`2026/10/15`、`2026.10.15` 都能识别，统一存成 `YYYY-MM-DD`；
  真正无法识别（如 `2026/13/01`）才报错
- 实测：桌面 Excel 导出的 GBK 文件（13 行）直接导入成功，**0 错误 0 跳过**

### Excel 操作要点

1. 用 Excel 打开 `lots.csv` → **另存为 CSV UTF-8**（不要 xlsx，导入器只读 CSV）
2. **不要改表头**（列名/顺序都别改），行数随意加
3. **先把 `received_date` 列格式设为文本**，否则 Excel 可能写成 `2026/10/15`
4. 空行会被忽略；`material_code` 留空的行会报错（方便你发现漏填）
5. 不确定的行先留着不填，dry-run 会告诉你哪行有问题，不会写库

### 数据从哪来

- **采购/入库台账**（ERP 的收货单、供应商送货单）
- **质保书/材质证明**（炉号、证书号）
- **来料检验记录**（决定 `quality_status`）

> 如果你们台账是 Excel 且列名不一样，把原表发我，我可以加一个"列名映射"直接转换，不用手工改。

## 三·五、先看"还差多少"：完备度报告

```bash
node scripts/data-backfill.js --report
```

输出（JSON）包含：物料/批次覆盖、BOM 行有多少挂了物料/批次/序列号、OEE 有多少班次有显式基线、
以及**哪些物料还没有任何批次**（`materials_without_lot`，可直接拿去登记批次）。

## 四、常见错误

| 报错 | 原因 / 处理 |
|---|---|
| `BOM 行不存在` | `part_number` 与库里的不一致（用模板里的原值） |
| `批次号不存在` | 先在物料/批次模块登记该批次 |
| `批次物料与 BOM 物料不一致` | 批次挂错物料，或该行本来就是替代料（确认后加开关） |
| `序列号不存在` | 先用 `--type=serials` 建档，再关联 BOM |
| `最近备份已 x.xh 前` | 先备份：`bash scripts/backup-db.sh` |
