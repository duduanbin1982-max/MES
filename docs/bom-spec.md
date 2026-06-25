# BOM 规范 (P2 全面升级)

> 对照 [一张合格的设备BOM表](https://mp.weixin.qq.com/s/wF_oYZiG5sQ5vfNi1uuJ5w) 12 字段 + 4 级结构规范
> 落地于 `instance_bom` 表 + `bomService.js` + `BomManagement.vue`
> 更新时间: 2026-06-25 (P2.1: 4 级拆分法)

## 一、4 级层级拆分法 (核心原则)

> **BOM 不是一锅炖的大表格**, 必须按装配层级拆分, 每一级对应不同部门使用需求. 层级混乱是 BOM 失效的头号原因.

| tier | 含义 | 数量级 | 使用部门 | 查询端点 |
|------|------|--------|----------|----------|
| 0 | 总装成品 | 1 (唯一根) | 整机/项目 | `?view=tree&part_id=root` |
| 1 | 部件/模组 | 5-20 | 装配班组 | `?view=flat&tier=1` |
| 2 | 零件与外购件 | 50-500 | 采购/工艺 | `?view=flat&tier=2` |
| 3 | 原材料毛坯 | 0-50 | 生产下料 | `?view=flat&tier=3` |

**核心原则**: 领料的人拿到对应部件的清单, 就能凑齐这个模组的所有零件, 不用去别的地方找.

## 二、API 端点 (4 级拆分)

| 方法 | 路径 | 用途 | 对应部门 |
|------|------|------|----------|
| GET | `/api/equipment_instances/:id/bom` (默认 tree) | 树状总览 | 项目经理 |
| GET | `/api/equipment_instances/:id/bom?view=flat&tier=0` | 总装清单 (1 行) | 整机发货 |
| GET | `/api/equipment_instances/:id/bom?view=flat&tier=1` | 部件清单 | 装配班组领料 |
| GET | `/api/equipment_instances/:id/bom?view=flat&tier=2` | 零件清单 | 采购下单 / 工艺 |
| GET | `/api/equipment_instances/:id/bom?view=flat&tier=3` | 毛坯清单 | 生产下料 |
| GET | `/api/equipment_instances/:id/bom?view=tree&part_id=N` | 某部件子树 | 装配班组 |
| GET | `/api/equipment_instances/:id/bom/levels` | 4 级一次性 | 前端统计卡 |
| GET | `/api/equipment_instances/:id/bom/cost` | 成本汇总 (MRP) | 成本核算 |
| GET | `/api/equipment_instances/:id/bom/validate` | 5 维校验 | 设计自查 |
| POST | `/api/equipment_instances/:id/bom` | 新增节点 | 设计录入 |
| PUT | `/api/bom/:id` | 更新节点 | 设计修改 |
| DELETE | `/api/bom/:id` | 级联删除子树 | 设计清理 |
| POST | `/api/equipment_instances/:id/bom/import` | CSV 导入 | 批量录入 |
| GET | `/api/equipment_instances/:id/bom/compare` | ECO 对比 | 变更追溯 |

## 三、12 必填字段 (按文章)

| # | 字段 | 必填 | 文章对照 | 库字段 |
|---|------|------|----------|--------|
| 1 | 层级号 | ✓ | 层级号 | `tier` (0-3) |
| 2 | 物料编码 | tier 1-3 必填 | 物料编码 | `material_id` → `materials.id` |
| 3 | 物料名称 | 间接 (经 material) | 物料名称 | `materials.material_name` |
| 4 | 图号/型号 | 推荐 | 图号/型号 | `part_number` |
| 5 | 单台数量 | ✓ | 单台数量 | `quantity` |
| 6 | 单位 | ✓ | 单位 | `unit` (件/个/米/千克/套) |
| 7 | 物料分类 | ✓ | 物料分类 | `category` (8 大类枚举) |
| 8 | 材质/牌号 | 自制件必填 | 材质/牌号 | `material_grade` |
| 9 | 表面处理 | 自制件必填 | 表面处理/热处理 | `surface_treatment` |
| 10 | 推荐品牌 | 外购件必填 | 推荐品牌/等级 | `brand_recommend` + `brand_grade` (A/B/不可替代) |
| 11 | 版本号 | 推荐 | 版本号 | `version` (A0/A1/B0) |
| 12 | 备注 | 选填 | 备注 | `notes` |

**附加字段**: `eco_id`, `effective_from/to`, `scrap_factor`, `is_phantom`, `is_key_component`, `is_wear_part`, `alternative_group/priority`, `operation_id`, `storage_location`, `weight`, `unit_price`, `created_by/at`, `updated_at`

## 四、6 条黄金规范 (文章)

| # | 规范 | 系统实现 |
|---|------|----------|
| 1 | 按装配顺序拆分层级, 不按零件类型堆砌 | 4 个独立 tier 查询端点, 前端 4 tab 拆分 |
| 2 | 一物一码 同物同码 异物异码 | `material_id` FK 强约束 + validateTree 检查 |
| 3 | 粒度到最小单元, 不模糊汇总 | quantity 必填 > 0, 拒绝"若干"/"几件" |
| 4 | 版本同步变更, 改图必改BOM | `version` + `eco_id` + ECO 对比 API |
| 5 | 只填净用量, 不含损耗 | `quantity` 净用量; `scrap_factor` 默认 1.0 |
| 6 | 易损件/备件单独标识 | `is_wear_part` 字段, 备件库查询接口待补 |

## 五、成本计算 (MRP)

```
cost(leaf)   = qty * unit_price * scrap_factor  (虚项 = 0)
cost(parent) = self(parent) + Σ cost(child)
self(parent) = parent.qty * parent.unit_price * parent.scrap_factor  (虚项 = 0)
```

浮点处理: `Math.round(x * 10000) / 10000` 避免 IEEE 754 误差.

## 六、5 维校验 (validateTree)

| # | 维度 | 报错信息 |
|---|------|----------|
| 1 | 根唯一 | `缺少根节点 (tier=0)` / `多个根节点 (N)` |
| 2 | 循环引用 | `循环引用: id=N` (三色 inStack DFS) |
| 3 | 数量 ≤ 0 | `quantity <= 0: id=N` |
| 4 | 物料不存在 | `物料不存在: bom_id=N, material_id=M` |
| 5 | 虚项作叶子 | `虚项 (bom_id=N) 必须是父节点` |

## 七、ECO 变更流程

1. 设计变更: `/eco` 创建 `instance_eco` 记录
2. BOM 复制: 当前 BOM 复制, version = `A1`/`B0`, `eco_id` = 新 ECO
3. BOM 调整: 修改变更字段
4. ECO 对比: `/bom/compare?v1=A0&v2=A1` 看 added/removed/changed
5. 生效: 设 `effective_from` 启用新版本
6. 审计: `audit_logs` 记录所有变更

## 八、CSV 导入格式

```csv
tier,parent_id,material_id,quantity,unit,category,material_grade,scrap_factor
0,,,1,台,成品,,
2,1,18,3,件,外购成品,Q345,1.05
1,1,,1,套,自制部件,45钢,1.0
```

**约束**:
- 必填列: tier, quantity, unit, category
- parent_id 留空 = 根, 数字 = 引用同 CSV 内已存在节点 (按行序)
- scrap_factor 默认 1.0, 范围 1.0-2.0
- 校验失败行不导入, 不阻塞后续行

## 九、前端 4 级 Tab 拆分

`BomManagement.vue` 顶部 4 个统计卡 (点击切换 tab):
- 0 总装: 1 项, 整台设备 (1 个根)
- 1 部件: 9 项, 装配班组按部件领料
- 2 零件: 39 项, 采购下单 / 加工领料
- 3 毛坯: 19 项, 生产下料

下方主 tab:
- 🌲 总览 (树状): 完整 4 级树视图 + 节点详情 + 成本表
- 总装 / 部件 / 零件 / 毛坯: 该层独立清单 (el-table), 部件 tab 可"下钻"看子件

## 十、与文章差异 / 后续规划

- **未实现**: 物料替换/合并工具
- **未实现**: 备件库自动同步
- **未实现**: 工序联动 (operation_id 字段已有)
- **计划**: P3 BOM 模板/快照 (冻结某版本 BOM 供采购/生产)
