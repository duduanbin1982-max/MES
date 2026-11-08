# 编码规则模块审计报告

> 日期：2026-11-08  
> 模块：编码规则（`/coding-rules`）  
> 相关代码：`services/codingRulesService.js`、`services/equipment/codeGenerator.js`、`equipment` 实例/模板创建链路、`frontend/src/views/CodingRules.vue`  
> 结论：**原模块基本是“假模块”——菜单指向主数据治理，编码规则硬编码在代码里，无配置页、无规则表、无原子序列。本轮已落地配置化规则/序列/预览/页面，并接入装备与模板编码。**

## 1. 审计发现（改造前）

| 编号 | 级别 | 问题 | 证据/影响 |
|---|---|---|---|
| F-01 | **P0** | “编码规则”菜单实际指向 `/mdm`（主数据治理），没有独立编码规则页面 | 用户点“编码规则”看到的是主数据治理，无法配置编码 |
| F-02 | **P0** | 编码规则硬编码在 `codeGenerator.js`：`TBM-[客户缩写]-YYYY-###`、`TPL-[分类]-YYYY-###` | 改前缀/年份/位数/分隔符必须改代码发版 |
| F-03 | P1 | 客户缩写 `cleanCodeToken` 直接去非 ASCII：中文客户名 → 空 token | 不同中文客户都生成 `TBM-YYYY-###`，无法区分客户 |
| F-04 | P1 | 序列按 `ORDER BY id DESC` 取最后一条 + 正则递增 | 存在手工/异常编码时可能取错基数，产生重复或跳号 |
| F-05 | P1 | 预览与创建没有原子序列；创建使用前端传入的 `instance_code` | 并发预览/创建可能撞 `UNIQUE`，返回 500；没有预留机制 |
| F-06 | P1 | 模板编码没有预览/配置，且同样硬编码 | 模板编码规则无法统一治理 |
| F-07 | P1 | `code-preview` 返回的 `rule` 是固定字符串，与实际生成逻辑可能不一致 | 前端展示的规则说明不可信 |
| F-08 | P1 | 手工输入装备编码没有格式/重复前置校验 | 重复时直接 SQLite 500，格式错误可写入 |
| F-09 | P1 | 编码生成/规则变更无审计 | 无法追溯谁改过规则/序列 |
| F-10 | P2 | 无编码序列重置策略（年度/月度/不重置） | 跨年无法自动重新从 001 开始 |
| F-11 | P2 | 无编码规则测试 | 上述问题无回归保护 |

## 2. 生产数据（改造前）

| 项目 | 数值 |
|---|---:|
| 项目装备编码 | 5 条（`TBM-2026-001/002/003`、`TBM-1-2026-001`、`TBM-DEMO-001`） |
| 项目模板编码 | 1 条 `TPL-TBM-STD` |
| 编码规则表 | **不存在** |
| 编码序列表 | **不存在** |

`TBM-2026-001` 等编码证明中文客户名被清洗成空 token；`TBM-1-2026-001` 说明手工编码已混入，进一步放大“按 id 取最后一条”的风险。

## 3. 本轮落地

### 3.1 规则/序列表

新增 `coding_rules`：

- `rule_code`、`name`、`entity_type`（equipment_instance / equipment_template / generic）；
- `prefix`、`separator`；
- `year_mode`：none/year/month；
- `customer_mode`：none/token；
- `customer_map_json`：客户名 → 缩写映射（解决中文客户问题）；
- `sequence_width`、`reset_policy`（never/year/month）、`is_active`、`description`。

新增 `coding_sequences`：

- `(rule_code, period_key)` 唯一；
- `last_sequence` 原子递增；
- 支持按年/按月重置。

默认规则：

- `equipment_instance`：`TBM-[客户]-YYYY-###`；
- `equipment_template`：`TPL-[分类]-YYYY-###`。

### 3.2 编码生成器

新增 `createCodeAllocator(db)`：

- `nextCode(rule, context, { preview })`：预览不消耗序列，创建时原子递增；
- 自动跳过已存在编码（最多 200 次）；
- `reserveCode`：手工编码创建时把序列至少推进到该编号；
- `describeRule`：返回可展示的规则描述。

装备/模板链路接入：

- `/api/equipment_instances/code-preview` 改为按 `equipment_instance` 规则预览；
- 创建装备时：
  - 未传编码 → 原子生成；
  - 手工编码 → 重复前置校验 + 预留序列；
- 创建模板时：
  - 自动生成 → 原子序列；
  - 手工编码 → 预留序列。

### 3.3 编码规则 API/页面

新增接口：

- `GET /api/coding-rules`
- `GET /api/coding-rules/:ruleCode`
- `POST /api/coding-rules`
- `PUT /api/coding-rules/:ruleCode`
- `DELETE /api/coding-rules/:ruleCode`
- `GET /api/coding-rules/:ruleCode/preview?customer=&year=`

新增页面 `/coding-rules`：

- 规则清单、状态、格式说明；
- 新建/编辑规则；
- 客户映射 JSON（如 `{"郑州地铁集团":"ZZDT"}`）；
- 预览面板：选规则 + 客户/分类 + 年份，实时预览下一个编码；
- 只读用户看不到新建/编辑按钮。

菜单修复：

- `moduleManifest` 中 `coding-rules` 从 `/mdm` 改为 `/coding-rules`；
- 保留 `主数据治理` 独立菜单 `/mdm`，避免功能入口丢失。

### 3.4 权限/审计

- `/coding-rules` 读：`settings:read`；写：`settings:write`；
- 规则新增/修改/删除写 `audit_logs`；
- 装备编码预览使用统一规则描述。

## 4. 验证

| 项目 | 结果 |
|---|---|
| 新增 `tests/codingRules.test.js` | **2/2**（默认规则/预览不消耗/客户映射/年度重置；CRUD/重复/停用） |
| 全量部署闸门 | **937/0** ✅ |
| 前端 eslint / vue-tsc / build:safe | 0 / 0 / 通过（已部署） |
| 生产 API | 规则列表/装备预览/模板预览/装备 code-preview 均 200 |
| 生产预览 | `TBM-2026-004`（现有 001~003 被跳过）；模板 `TPL-TBM-2026-001` |
| Playwright | `/coding-rules` 2 条规则、预览面板、编辑弹窗正常，无 pageerror |

## 5. 当前生产状态

- 已创建 2 条默认规则；
- `coding_sequences` 初始为空；
- 现有 5 个项目装备编码未迁移、未回填序列；
- 首次创建装备时：
  - 未配置客户映射时，当前预览为 `TBM-2026-004`（自动跳过已有 001~003）；
  - 使用该编码创建后序列预留到 4，下次预览为 `TBM-2026-005`；
  - 配置客户映射后，新客户前缀会从 `TBM-ZZDT-2026-001` 开始。
- 中文客户当前仍生成 `TBM-YYYY-###`，需在页面配置客户映射后才带客户缩写。

## 6. 必须由业务处理

1. **配置中文客户缩写映射**  
   如 `郑州地铁集团 → ZZDT`、`杭州地铁 → HZDT`，否则编码仍无法区分客户。
2. **确定现有编码是否迁移**  
   现有 `TBM-2026-*` 与规则新格式不完全一致；建议保留历史，新增编码按新规则。
3. **确认年份/重置策略**  
   默认按年重置；跨年是否从 001 开始需业务确认。
4. **补齐其他对象规则**  
   当前只接入项目装备/项目模板；物料、工单、供应商等仍用各自编码逻辑，可在规则页新增 generic 规则后逐步接入。
5. **手工编码格式约束**  
   本轮做了重复校验/预留；尚未做严格格式（正则）校验，建议后续增加“允许手工覆盖”开关。

## 7. 遗留

1. 预览与创建仍是两次请求：并发极端场景下，两个用户可能拿到同一预览码，后创建者会被唯一约束/前置校验拦截；建议后续增加“预约”接口。
2. 手工输入编码未强制匹配规则格式。
3. 物料/工单等实体尚未接入编码规则。
4. 规则删除没有“已被使用”保护，建议增加引用检查。
5. 历史编码未回填序列；首次新编码会按现有最大/跳号逻辑生成。
6. 客户映射仍是手工 JSON，后续可做客户主数据下拉。

## 8. 复验

1. `https://192.168.1.73/coding-rules` → Ctrl+Shift+R；
2. 确认 2 条默认规则；
3. 编辑 `equipment_instance`，客户映射填 `{"郑州地铁集团":"ZZDT"}`；
4. 预览客户“郑州地铁集团”、2026 → 应得 `TBM-ZZDT-2026-001`（新客户段无历史序列）；
5. 到装备创建向导点“生成”，编码应使用同一规则；
6. `node --test tests/codingRules.test.js`。


## 9. 遗留问题闭环（2026-11-08 23:16）

| 原遗留 | 闭环方式 | 验证 |
|---|---|---|
| 预览与创建分两次请求，并发可能撞唯一约束 | 新增 `coding_reservations` 预约表；`POST /api/equipment_instances/code-reserve` 生成预约码/token；装备创建提交前先预约，创建时 `consume` 预约码；预约 15 分钟过期 | Playwright 创建向导/接口 smoke；预约消费后不可重复消费 |
| 手工编码未强制格式 | 装备手工编码只要以规则前缀开头（TBM），即按当前规则正则校验；不符合直接 400；非 TBM 前缀保留历史兼容 | `codingRules` CODE-3 校验通过/非法拒绝 |
| 物料/工单等未接入 | 新增 `work_order`、`material` 默认规则；工单创建支持留空自动生成 `WO-YYYY-###`；规则页可预览/预留物料、工单编码；物料主数据导入仍保留业务编码校验 | 工单页工单号改为“留空自动生成”；物料预览 `MAT-0001` |
| 规则删除无“已被使用”保护 | 删除前检查 `coding_sequences`，已产生编码返回 409，提示改为停用 | `codingRules` CODE-3 删除 work_order 规则返回 409 |
| 历史编码未回填序列 | `runMigration`/规则新增更新时执行 `backfillSequences`，按前缀+年度取历史最大序号回填 | 生产 equipment 2026 序列回填为 3；work_order 2026 回填为 2 |
| 客户映射手填 JSON | 规则页增加客户主数据下拉（`GET /coding-rules/customer-options`）+ 缩写输入 + 映射标签，仍保留 JSON 编辑 | Playwright 编辑弹窗出现客户下拉，无 pageerror |

### 9.1 本轮新增验证

- `tests/codingRules.test.js`：**3/3**（新增预约消费、序列回填、格式校验、物料/工单规则、删除保护）。
- 全量部署闸门：**938/0**。
- 生产 API smoke：rules / customer-options / material-preview / work_order-preview / equipment code-reserve 均 200。
- Playwright：`/coding-rules` 4 条规则、客户映射下拉、预览正常；`/work-orders` 正常；无 pageerror。

### 9.2 仍需注意

1. 预约未消费会留下序号空档（15 分钟后过期，但不会回退序列）；后续可增加定时清理/回收策略。
2. 工单/物料的历史编码可能不符合新规则，因此只对“以规则前缀开头”的手工编码做强校验，其他历史前缀保留兼容。
3. 物料主数据目前仍以导入/业务编码为主，规则页提供预览/预留；是否自动生成物料码需业务确认一物一码策略。
4. 规则删除保护基于序列表；若某规则从未生成编码，仍可删除。
