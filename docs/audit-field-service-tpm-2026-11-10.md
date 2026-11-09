# 点检 / TPM 模块审计报告

> 日期：2026-11-10  
> 模块：`/field-service`「点检 / TPM」  
> 代码：`frontend/src/views/FieldService.vue`、`frontend/src/composables/useFieldServicePage.ts`、`services/fieldService.js`  
> 结论：**发现 4 个 P0、5 个 P1；本轮修复 9 项，新增回归 1 条，全量闸门 952/0。**

## 1. 审计范围

- 维保计划新增/编辑/完成；
- 执行维保与维保记录；
- 逾期维保统计；
- 点检表；
- 故障报修；
- 备件库/低库存；
- 页面 Tab、字段映射、筛选、错误提示、测试。

## 2. P0 问题

### P0-1：计划表单字段与后端完全错位

前端发送：

```text
component_name / interval / last_done / next_due
```

后端表/接口使用：

```text
plan_name / frequency_days / last_done_date / next_due_date
```

结果：

- 计划名称被后端用 `maintenance_type` 兜底成“预防性”；
- 周期永远 90；
- 下次到期为空；
- 表格的部件/周期/日期列全部空白。

### P0-2：执行维保必然 400

前端提交：

```text
maintenance_plan_id / equipment / component
```

后端要求：

```text
plan_id / equipment_instance_id
```

因此“执行维保”永远失败，维保记录写不进去，计划也不会完成。

### P0-3：逾期维保 KPI 永远 0

`/api/field-service/overdue` 返回数组，前端按对象读 `res.count`：

```js
res.count || res.total || 0
```

数组没有这些字段，所以逾期数始终为 0；实际生产有 **4 条**逾期计划。

### P0-4：点检 / 故障报修功能未暴露

后端已有：

```text
/api/field-service/checklists
/api/field-service/breakdowns
```

页面只有“维保计划 / 维保记录 / 备件库”三个 Tab，**点检表、故障报修完全没有入口**。模块名叫“点检 / TPM”，但点检不可用。

## 3. P1 问题

| 编号 | 问题 | 处理 |
|---|---|---|
| T-05 | 维保记录筛选传 `start_date/end_date/equipment`，后端不识别；表格列 `equipment/component` 字段不存在 | 后端补日期/装备/状态筛选，JOIN 计划/用户，返回 `instance_code/plan_name/performer_name` |
| T-06 | 备件接口不返回 `current_stock`，页面库存列空白 | 后端补 `sp.quantity AS current_stock` |
| T-07 | 计划列表只显示 `equipment_instance_id`，不显示装备编码 | 表格改为 `instance_code + instance_name` |
| T-08 | 错误提示为 Axios 通用文案 | 统一 `response.data.error` |
| T-09 | 无 TPM 回归测试 | 新增 `tests/fieldServiceTpm.test.js` |

## 4. 本轮修复

### 4.1 计划字段统一

前端改为：

```text
equipment_instance_id / plan_name / maintenance_type / frequency_days /
last_done_date / next_due_date / status / notes
```

- 装备用下拉选择；
- 类型支持周检/月检/季检/例行/预防/纠正/预测；
- 日期使用 `YYYY-MM-DD` 选择器。

### 4.2 执行维保

- 提交 `plan_id + equipment_instance_id`；
- 执行人默认当前登录用户，可手填用户 ID；
- 写维保记录后调用：

```text
POST /api/field-service/maintenance-plans/:id/complete
```

- 计划状态完成，按周期顺延下次到期。

### 4.3 记录/逾期/备件

- 日志接口补日期、装备、状态筛选；
- JOIN `maintenance_plans`、`users`，列表显示计划名称/执行人；
- 逾期 KPI 按数组长度计算；
- 备件接口返回 `current_stock`，低库存 KPI 正确。

### 4.4 新增点检表/故障报修

- 新增“点检表”Tab：
  - 新建点检表（装备/名称/类型）；
  - 按检查项逐项执行，结果写维保记录；
- 新增“故障报修”Tab：
  - 报修单号自动生成；
  - 严重度/状态/停机工时/根因/处理措施；
  - 处理弹窗更新状态。

### 4.5 页面

- 标题改为“点检 / TPM”；
- KPI：逾期维保、待处理故障、点检表、低库存；
- 五个 Tab：维保计划 / 维保记录 / 点检表 / 故障报修 / 备件库；
- 所有列表/弹窗字段与后端一致。

## 5. 生产数据

| 数据 | 数量 |
|---|---:|
| 维保计划 | 5 |
| 维保记录 | 6 |
| 点检表 | 1 |
| 故障报修 | 3（待处理 2） |
| 备件 | 5（低库存 4） |
| 逾期维保 | **4** |

页面实际显示：

- 逾期 KPI=4；
- 待处理故障=2；
- 点检表=1；
- 低库存=4；
- 5 条计划，含装备编码/名称、计划名称、周/月/季检、周期、到期、状态。

## 6. 验证

| 项目 | 结果 |
|---|---|
| 新增 `tests/fieldServiceTpm.test.js` | **1/1**（计划字段/执行/筛选/点检/故障） |
| 全量部署闸门 | **952/0** ✅ |
| 前端 eslint / typecheck / build | 通过（已部署） |
| 生产 TPM API | 计划/记录/点检/故障/备件/逾期/仪表板全部 200 |
| Playwright | 标题“点检 / TPM”、KPI 4/2/1/4、五个 Tab、计划行、执行弹窗正常，无 pageerror |

## 7. 仍需注意

1. **本 TPM 当前针对项目装备（`equipment_instance_id`）**，不是车间生产设备；车间设备维保在“设备台账-维保”（`equipment_maintenance_plans`）。  
   如果点检/TPM 也要覆盖车间生产设备，需要再决定是否合并/切换数据源。
2. 执行人使用用户 ID（默认当前用户），没有做用户选择器。
3. 点检表检查项使用后端默认模板，暂不支持前端自由编辑检查项。
4. 故障报修未接附件、审批、备件领用和停机 OEE 自动扣减。
5. 计划完成即 `completed` 并按周期顺延，没有“重新打开/跳过本次”等操作。
6. 备件库仍以项目装备为维度，未与车间设备备件统一。
7. 列表没有分页；当前计划/记录/故障数量较小。

## 8. 复验

1. `https://192.168.1.73/field-service` → Ctrl+Shift+R；
2. 确认标题“点检 / TPM”，KPI 逾期 4、待处理故障 2、点检表 1、低库存 4；
3. 维保计划应显示装备编码/名称、计划名称、类型、周期、到期；
4. 新建计划：选装备、填计划名称/周期/日期，保存后列表可见；
5. 执行维保：提交后生成记录，计划状态完成并顺延；
6. 点检表：执行点检，逐项选正常/异常，提交后维保记录出现；
7. 故障报修：新建故障单，处理弹窗更新状态/停机/根因；
8. `node --test tests/fieldServiceTpm.test.js`。
