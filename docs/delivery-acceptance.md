# 交付单与验收单

> 建立日期：2026-11-02  
> 代码：`services/delivery/records.js`、`frontend/src/views/delivery/InstanceDeliveryTab.vue`  
> 目的：补「交付/验收无独立单据表」断点 —— 之前交付与验收只有里程碑阶段标记，没有可承载发运批次、承运信息、验收结论与客户签署的单据。

## 1. 两张表

### 1.1 `delivery_orders` 交付单

| 字段 | 说明 |
|---|---|
| `delivery_no` | 单号，自动生成 `DO-<实例编码>-001`（同实例递增） |
| `delivery_type` | `machine` 整机 / `spare_parts` 备件 / `tools` 工装工具 / `other` |
| `planned_date` / `actual_date` | 计划 / 实际日期（推进到已发货、已到场时自动填当天） |
| `status` | `planned` → `shipped` → `in_transit` → `arrived` → `accepted`；任意状态可 `cancelled` |
| `transport_mode` | `road` / `rail` / `sea` / `air` |
| `carrier` / `tracking_no` | 承运单位 / 运单号 |
| `ship_to` / `contact_name` / `contact_phone` | 收货地点与联系人 |
| `package_count` / `gross_weight` | 包装件数 / 毛重(kg) |
| `certificate_document_id` | 合格证/随机文件（关联 `documents.id`，软引用） |
| `milestone_id` | 关联里程碑（软引用，**不会反向修改里程碑**） |

### 1.2 `acceptance_records` 验收单

| 字段 | 说明 |
|---|---|
| `acceptance_no` | 单号，自动生成 `AC-<实例编码>-001` |
| `acceptance_type` | `fat` 厂内验收 / `sat` 现场验收 / `final` 终验 |
| `result` | `pending` → `passed` / `conditional`（让步接收）/ `rejected` |
| `condition_note` | 让步接收必须填写（原因 / 后续措施） |
| `signer_name` / `signer_title` / `signed_at` | 客户签署人、职务、签署时间（签署时写） |
| `report_document_id` | 验收报告（关联 `documents.id`） |
| `delivery_order_id` / `milestone_id` | 关联交付单 / 里程碑（软引用） |

## 2. 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/equipment_instances/:id/deliveries` | 交付单列表 |
| POST | `/api/equipment_instances/:id/deliveries` | 新建（单号自动） |
| PUT | `/api/deliveries/:id` | 编辑（**忽略 status**，状态只能走状态机） |
| POST | `/api/deliveries/:id/status` | 推进状态（非法流转 400，附允许列表） |
| DELETE | `/api/deliveries/:id` | 删除 |
| GET | `/api/equipment_instances/:id/acceptances` | 验收单列表 |
| POST | `/api/equipment_instances/:id/acceptances` | 新建（单号自动） |
| PUT | `/api/acceptances/:id` | 编辑（**忽略 result**，结论只能通过签署） |
| POST | `/api/acceptances/:id/sign` | 签署：结论 + 签署人 + 职务 + 日期 |
| DELETE | `/api/acceptances/:id` | 删除 |

状态机（后端 `DELIVERY_TRANSITIONS`，前端展示同构）：

```
planned → shipped → in_transit → arrived → accepted
   └──────────┴──────────┴─────────┴──→ cancelled
accepted / cancelled 为终态
```

## 3. 与健康检查的关系

「交付与成本」环节的口径更新：

- **交付证据** = 交付里程碑 **或** 交付单（未取消）；
- ok 仍要求 `成本类型 ≥ 2`；
- 有交付但**验收单为 0** 时，卡点会提示「还没有验收记录（验收单未签署）」，但不影响 ok 判定（避免在建项目永远不达标）；
- 指标新增 `交付单` / `验收单` 两个计数，健康检查卡片直接可见。

## 4. 前端

实例详情新增「交付验收」标签页（`frontend/src/views/delivery/InstanceDeliveryTab.vue`）：

- 左：交付单表格 —— 推进状态（下拉只列合法下一步）、编辑、删除；
- 右：验收单表格 —— 签署（结论/签署人/职务/日期，让步必填说明）、编辑、删除；
- 展示逻辑抽到 `frontend/src/domain/deliveryRecords.ts`（5 条单测：文案、状态机、类型、结论、签署摘要）。

## 5. 设计取舍

1. **不反向改里程碑**：单据是事实记录，里程碑是计划；两者用 `milestone_id` 软关联，避免两个模块互相写。
2. **状态机只前进**：允许取消，不允许回退（真实业务里"已验收再退回运输中"应通过新单据或异常流程）。
3. **单号按实例递增**：`DO-<实例编码>-<序号>`，可读、可对账；唯一索引兜底。
4. **删除是硬删**：单据录错时直接删；若要留痕，后续可改成软删 + 审计事件。
5. **跨模块只读**：本模块只读 `equipment_instances` / `documents`，只写自己的两张表（符合模块边界规则）。

## 6. 已知限制

1. 交付单目前是**整机/批次级**，没有"装箱清单明细表"（`delivery_items`）——如需按件明细，后续加子表。
2. 验收签字是**记录**，不是电子签章（无签名图片/PDF 固化）。
3. 尚未与 `field_service`/质保期联动（到货/验收后可自动起算质保，属后续增强）。
