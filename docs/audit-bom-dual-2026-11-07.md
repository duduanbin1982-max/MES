# EBOM/MBOM 双 BOM + 版本/有效性/Redline 对比 实施报告

> 日期：2026-11-07  
> 范围：BOM 管理（`/bom`）  
> 目标：把单一 BOM 升级为 **设计 EBOM / 制造 MBOM 双 BOM**，并补齐 **版本类型、基线、生效日期、版本 Redline 对比**。  
> 结果：核心能力落地；新增回归 2/2；全量部署闸门 **904/0**。

## 1. 交付摘要

| 能力 | 交付 |
|---|---|
| 双 BOM 数据模型 | `instance_bom` 新增 `bom_type`（EBOM/MBOM）、`source_bom_id`（MBOM 行来源 EBOM 行）；历史数据默认 EBOM |
| EBOM→MBOM | 一键克隆：保留层级、parent 映射、来源行，生成 MBOM 后独立编辑 |
| 类型隔离 | BOM 列表/层级/成本/健康/校验/修复/版本均按 `bom_type` 过滤；父子跨类型、单根约束按类型分别校验 |
| 版本类型/基线 | `bom_version_releases` 新增 `bom_type`、`baseline_type`（contract/design/manufacturing/other）；发布时按类型快照、健康门禁 |
| 有效性 | `GET /bom/effectivity?bom_type=&as_of=`：按日期返回生效版本/行数，未生效/已失效行 |
| Redline | `GET /bom/redline?from_release_id=&to_release_id=`：对比两次发布快照，输出新增/删除/字段变更/父节点移动、数量差、金额差 |
| 前端 | EBOM/MBOM 切换、空 MBOM“从 EBOM 生成 MBOM”、Redline 对比弹窗 |

## 2. 数据模型与接口

### 2.1 字段

`instance_bom`：
- `bom_type TEXT DEFAULT 'EBOM'`；
- `source_bom_id INTEGER`（MBOM 行对应的 EBOM 行 id）。

`bom_version_releases`：
- `bom_type TEXT DEFAULT 'EBOM'`；
- `baseline_type TEXT`（合同/设计/制造/其他基线）。

### 2.2 新增/调整接口

| 接口 | 说明 |
|---|---|
| `POST /api/equipment_instances/:id/bom/clone-to-mbom` | EBOM→MBOM 克隆；已有 MBOM 时 409；写审计 |
| `GET /api/equipment_instances/:id/bom?bom_type=EBOM\|MBOM` | 列表/树按类型过滤，支持 `as_of` |
| `GET /bom/levels?bom_type=...` | 层级统计按类型 |
| `GET /bom/cost?bom_type=...` | 成本按类型 |
| `GET /bom/health?bom_type=...` / `GET /bom/validate?bom_type=...` | 健康/校验按类型 |
| `POST /bom/repair/preview|apply` | 支持 `bom_type`，按类型修复根/孤儿 |
| `POST /bom/versions/release` | body 支持 `bom_type`、`baseline_type`；按类型生成快照，健康门禁 |
| `GET /bom/versions?bom_type=...` | 版本列表按类型过滤 |
| `GET /bom/effectivity?bom_type=&as_of=` | 生效版本/行数、失效行 |
| `GET /bom/redline?from_release_id=&to_release_id=` | 版本快照 Redline |

## 3. 双 BOM 行为

### 3.1 EBOM→MBOM 克隆

- 只允许从 EBOM 复制到空 MBOM，避免覆盖；
- 保留 `tier / parent_id / 物料/图号/数量/单位/成本/替代/有效性`；
- 写入 `source_bom_id` 建立“制造行 → 设计行”追溯；
- 生成后 EBOM/MBOM 独立维护；后续 EBOM 变化不会自动同步到 MBOM（需重新克隆或手工调整）。

### 3.2 类型隔离

- 新增/更新节点时校验父节点同类型；
- 每个类型各自单根；跨类型父子节点被拒绝；
- 删除/移动/版本/健康/成本均按类型隔离，避免 EBOM/MBOM 混树。

### 3.3 前端

- 页面顶部增加 `EBOM 设计 / MBOM 制造` 切换；
- MBOM 为空时显示“从 EBOM 生成 MBOM”；
- MBOM 有数据时显示“Redline 对比”；
- Redline 弹窗选择版本后展示新增/删除/变更/数量金额差。

## 4. 版本/有效性/Redline

### 4.1 版本

- 发布时按 `bom_type` 取行并快照；
- `bom_version_releases` 记录 `bom_type / baseline_type / effective_from / effective_to / row_count / released_at`；
- 沿用健康分发布门禁（结构校验 + 健康分门槛，管理员可 force）。

> 版本号在同一实例内共用命名空间（EBOM 与 MBOM 不能同时用 `A1`）；建议 MBOM 使用 `M1/M2` 或 `MA1`。

### 4.2 有效性

- `as_of` 日期下，返回生效的已发布版本（最新一条）及行数；
- 无生效版本时返回 0，并列出未生效/失效节点；
- 适用于“某日期/某阶段应该用哪版 BOM”的查询。

### 4.3 Redline

- 仅支持同类型版本对比；
- 输出：
  - 新增/删除节点数；
  - 字段级变更（数量、单位、单价、成本、材质、替代、有效性等）；
  - 父节点移动；
  - 总数量差、金额差；
- 前端按“新增/删除/变更”页签展示。

## 5. 当前生产状态

| 实例 | EBOM 行数 | MBOM 行数 | 说明 |
|---|---|---|---|
| 1 | 68 | 0 | 默认 EBOM；MBOM 需点击生成 |
| 2 | 5 | 0 | 同上 |
| 6 | 5 | 0 | 同上 |

- 历史行全部归为 EBOM（`bom_type='EBOM'`）；
- 当前无 MBOM、无路线版本；功能已就绪，用户可在 `/bom` 切换到 MBOM 后一键生成。

## 6. 验证

| 项目 | 结果 |
|---|---|
| 新增 `tests/bomDual.test.js` | **2/2**：类型隔离+来源映射；版本/有效性/Redline |
| 既有 BOM 回归 | `bomGovernance` 12/12、`bomHealthRepair` 5/5 |
| 全量部署闸门 | **904/0** ✅ |
| 前端 eslint / vue-tsc / build:safe | 0 / 0 / 通过（已部署） |
| 生产 API | EBOM list 200（68 行）、MBOM list 200（0）、EBOM health 200、versions 200、effectivity 200；新列已迁移 |
| Playwright | `/bom` 切换 EBOM/MBOM 正常；MBOM 空时显示“从 EBOM 生成 MBOM”；无 pageerror |

## 7. 已知边界

1. **MBOM 为一次性克隆**：后续 EBOM 变更不会自动同步；需要“重新克隆/差异同步”功能；
2. **版本号共用**：EBOM/MBOM 不能同名版本；建议命名约定 M1/M2；
3. **有效性以发布版本为准**：行级 `effective_from/to` 不随发布自动回写；如需逐行有效期，后续补“发布即写入行有效期”；
4. **基线类型仅接口支持**：前端发布弹窗暂未选择 `baseline_type`，可后续补；
5. **Redline 以节点 id 对比**：删除再新增相同零件会显示删除+新增，不做业务键归并；
6. **MBOM 制造特有内容**：虚拟件/辅料/工装等需在 MBOM 上手工新增，克隆只保证结构一致；
7. **无 EBOM→MBOM 差异报告**：当前 Redline 只对比两个发布版本，不能直接对比“当前 EBOM vs 当前 MBOM”。

## 8. 复验方式

1. `https://192.168.1.73/bom` → Ctrl+Shift+R；
2. 切换到 `MBOM 制造` → 点击“从 EBOM 生成 MBOM”；
3. 在 MBOM 新增/修改节点；发布 MBOM 版本（版本号建议 M1）；
4. 修改后再发布 M2；点击“Redline 对比”选择 M1/M2，查看差异；
5. `node --test tests/bomDual.test.js`。
