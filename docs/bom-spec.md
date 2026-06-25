# BOM 规范 (P2 全面升级)

> 对照 [一张合格的设备BOM表](https://mp.weixin.qq.com/s/wF_oYZiG5sQ5vfNi1uuJ5w) 12 字段 + 4 级结构规范
> 落地于 `instance_bom` 表 + `bomService.js` + `BomManagement.vue`
> 更新时间: 2026-06-25

## 一、4 级层级结构

| tier | 含义 | 数量上限 | 典型内容 |
|------|------|----------|----------|
| 0 | 总装成品 | 1 (唯一根) | 整台设备, 1 个 instance 1 个根 |
| 1 | 部件/模组 | 5-20 | 机架组件、移栽模组、拧紧工位、电气柜 |
| 2 | 零件与外购件 | 50-500 | 自制机加件、标准紧固件、气动电气元件 |
| 3 | 原材料毛坯 | 0-50 | 型材、板材、棒料毛坯 (可选) |

**校验**:
- 根唯一 (tier=0 + parent_id IS NULL, 每 instance 只能 1 个根)
- tier 递进: 父 tier + 1 ≥ 子 tier (组件下挂零件, 不可越级)
- 虚项 (is_phantom=1) 不能是叶子: 必须有子节点或自身 tier 0

## 二、12 必填字段对照

| # | 字段 | 类型 | 必填 | 文章对照 | 库字段 |
|---|------|------|------|----------|--------|
| 1 | 层级号 | int 0-3 | ✓ | 层级号 | `tier` |
| 2 | 物料编码 | int FK | tier 1-3 必填 | 物料编码 | `material_id` → `materials.id` |
| 3 | 物料名称 | text | 间接 (经 material) | 物料名称 | `materials.material_name` |
| 4 | 图号/型号 | text | ✗ 推荐 | 图号/型号 | `part_number` |
| 5 | 单台数量 | real | ✓ | 单台数量 | `quantity` |
| 6 | 单位 | text | ✓ | 单位 (件/个/米/千克/套) | `unit` |
| 7 | 物料分类 | text | ✓ | 物料分类 | `category` (8 大类枚举) |
| 8 | 材质/牌号 | text | 自制件必填 | 材质/牌号 | `material_grade` |
| 9 | 表面处理/热处理 | text | 自制件必填 | 表面处理/热处理 | `surface_treatment` |
| 10 | 推荐品牌/等级 | text | 外购件必填 | 推荐品牌/等级 | `brand_recommend` + `brand_grade` (A/B/不可替代) |
| 11 | 版本号 | text | ✗ | 版本号 | `version` (A0/A1/B0) |
| 12 | 备注 | text | ✗ | 备注 | `notes` (左件/右件/配作/易损) |

**附加字段** (本系统增强):
- `eco_id` - 关联 `instance_eco.id` (设计变更追溯)
- `effective_from/to` - ECO 生效期
- `scrap_factor` - 损耗系数 (EBOM 净用量 → MBOM 实际采购量, 默认 1.0)
- `is_phantom` - 虚项 (不存库存/MRP, 仅结构)
- `is_key_component` - 关键件
- `is_wear_part` - 易损件 (备件库查询)
- `alternative_group` + `alternative_priority` - 替代料 (同组互替, 1=首选)
- `operation_id` - 关联 `process_tree_node.id` (物料在哪道工序消耗)
- `storage_location` - 库位
- `weight` - 单重 kg
- `unit_price` - 估价 (冗余自 materials, 加速成本汇总)
- `created_by` / `created_at` / `updated_at` - 审计

## 三、6 条黄金规范 (文章)

| # | 规范 | 系统实现 |
|---|------|----------|
| 1 | 按装配顺序拆分层级, 不按零件类型堆砌 | tier 字段强制层级结构, 树视图按 tier 展开 |
| 2 | 一物一码 同物同码 异物异码 | `material_id` FK 强约束, validateTree 检查 物料存在 |
| 3 | 粒度到最小单元, 不模糊汇总 | quantity 必填 > 0, 不允许 "若干"/"几件" |
| 4 | 版本同步变更, 改图必改BOM | `version` (A0/A1/B0) + `eco_id` + ECO 对比 API |
| 5 | 只填净用量, 不含损耗 | `quantity` 是净用量; `scrap_factor` 默认 1.0, MBOM 时启用 |
| 6 | 易损件/备件单独标识 | `is_wear_part` 字段, 备件库查询接口待补 |

## 四、成本计算 (calcCost)

公式 (符合 MRP 标准):

```
cost(leaf)        = qty * unit_price * scrap_factor  (虚项 = 0)
cost(parent)      = self(parent) + Σ cost(child)
self(parent)      = parent.qty * parent.unit_price * parent.scrap_factor  (虚项 = 0)
```

**关键修正 (commit 前版本 bug)**:
- ❌ 旧: `cost(parent) = Σ(cost(child) * child.qty * child.scrap) + self(parent)` (双倍累乘 child.qty)
- ✅ 新: `cost(parent) = Σ cost(child) + self(parent)` (child.qty 已含在 child.cost)

**浮点处理**: Math.round(x * 10000) / 10000 避免 110.00000000000001 这种 IEEE 754 误差.

## 五、5 维校验 (validateTree)

| # | 维度 | 报错信息 | 修复 |
|---|------|----------|------|
| 1 | 根唯一 | `缺少根节点 (tier=0)` / `多个根节点 (N)` | 删多余根 / 加缺失根 |
| 2 | 循环引用 | `循环引用: id=N` (DFS 三色 inStack 检测) | 断开 parent_id 环 |
| 3 | 数量 ≤ 0 | `quantity <= 0: id=N` | 改 quantity > 0 |
| 4 | 物料不存在 | `物料不存在: bom_id=N, material_id=M` | 改 material_id 为已存在物料 |
| 5 | 虚项作叶子 | `虚项 (bom_id=N) 必须是父节点, 不能是叶子` | 加子节点或取消虚项 |

## 六、ECO 变更流程

1. **设计变更**: 在 `/eco` 创建 `instance_eco` 记录 (title/reason/affected_scope)
2. **BOM 复制**: 当前 BOM 复制一份, version = `A1`/`B0` (新版本), `eco_id` = 新 ECO
3. **BOM 调整**: 修改变更的字段 (add/remove/change)
4. **ECO 对比**: `/bom/compare?v1=A0&v2=A1` 看到 added/removed/changed
5. **生效**: 设 `effective_from` 启用新版本, `effective_to` 终止老版本
6. **审计**: `audit_logs` 记录所有变更 (P1-4)

## 七、CSV 导入格式

```csv
tier,parent_id,material_id,quantity,unit,category,material_grade,surface_treatment,scrap_factor,is_phantom,is_key_component,is_wear_part,notes
0,,,1,台,成品,,,,,,
2,1,18,3,件,外购成品,Q345,喷塑RAL7035,1.05,0,0,1,易损
1,1,,1,套,自制部件,45钢,调质HB220-250,1.0,0,1,0,
```

**约束**:
- 必填列: tier, quantity, unit, category
- parent_id: 留空 = 根, 数字 = 引用同 CSV 内已存在的 tier (按行序)
- material_id: 留空 = 虚项 / 自制部件 (无物料)
- scrap_factor 默认 1.0, 范围 1.0-2.0
- 校验失败行不导入, 不阻塞后续行

## 八、API 端点

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/equipment_instances/:id/bom` | 拉 BOM 树 |
| GET | `/api/equipment_instances/:id/bom/cost` | 成本汇总 (含每节点 self/cost) |
| GET | `/api/equipment_instances/:id/bom/validate` | 5 维校验 |
| POST | `/api/equipment_instances/:id/bom` | 新增节点 |
| PUT | `/api/bom/:id` | 更新节点 |
| DELETE | `/api/bom/:id` | 级联删除子树 |
| POST | `/api/equipment_instances/:id/bom/import` | CSV 导入 |
| GET | `/api/equipment_instances/:id/bom/compare` | ECO 版本对比 |

权限: `equipment:read` (与设备实例同).

## 九、与文章差异 / 后续规划

- **未实现**: 物料替换/合并工具 (一物多码自动归并)
- **未实现**: 备件库自动同步 (is_wear_part 标记后, 推送到备件库)
- **未实现**: 工序联动 (operation_id 已存, 但未实装 MRP 触发)
- **计划**: P3 BOM 模板/快照 (冻结某版本 BOM 供采购/生产)
