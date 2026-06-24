# TBM-MES API 文档 (v2.1)

> 基础 URL: `http://192.168.1.73:3890/api`
> 认证: 除 `/api/auth/login` 和 `/api/health` 外, 需 `Authorization: Bearer <token>` 头
> 演示账号: 密码 = 用户名 (admin / foreman01 / engineer01 / worker01 / qc01 / welder01)

---

## 🔐 认证

### POST /api/auth/login
登录获取 token
- Body: `{ "username": "admin", "password": "admin" }`
- 200: `{ token, user: { id, username, full_name, role, role_name } }`
- 401: 错误

### GET /api/auth/me
当前用户信息（需 token）
- 200: `{ id, username, full_name, role, role_name }`

### POST /api/auth/logout
登出（前端清 token 即可）

---

## 🏥 健康 / 看板

### GET /api/health (public)
- 200: `{ status: "ok", service, version, tables, instances, time }`

### GET /api/dashboard
- 200: `{ equipment_types, equipment_models, instances: { total, by_status, by_type }, work_orders, bom_total, key_components, long_leadtime, open_eco, open_field_service }`

---

## 🏷️ 主数据 (产品类别 / 型号 / 子系统 / 工位 / 设备)

### GET /api/equipment_types
产品类别 (TBM / BREAKER / EXCAVATOR / PUMP)

### GET /api/equipment_types/:id
详情 (含 model_count, instance_count)

### GET /api/equipment_models?equipment_type_id=
型号列表

### GET /api/equipment_subsystems?equipment_type_id=
子系统列表 (9 大子系统)

### GET /api/workstations, GET /api/equipment

---

## 📦 装备实例 (核心实体)

### GET /api/equipment_instances
Query: status / customer / equipment_type_id

### GET /api/equipment_instances/:id

### POST /api/equipment_instances
Body: instance_code / instance_name / equipment_model_id / customer_name / customer_contact / site_location / contract_no / contract_amount / start_date / planned_start / planned_end / serial_no / notes

### PUT /api/equipment_instances/:id

### DELETE /api/equipment_instances/:id (级联)

### GET /api/equipment_instances/:id/dashboard
聚合视图

---

## 🌳 实例 BOM (5 级)

### GET /api/equipment_instances/:id/bom (扁平)
### GET /api/equipment_instances/:id/bom/tree (树)
### POST /api/equipment_instances/:id/bom
Body: parent_id / material_id / level / quantity / is_key_component / is_alternative / alternative_group / notes
### DELETE /api/equipment_instances/:id/bom/:bom_id

---

## 🚩 实例里程碑 (S1-S10)

### GET /api/equipment_instances/:id/milestones
### POST /api/equipment_instances/:id/milestones/auto-generate
### PUT /api/milestones/:id

---

## 📑 工单

### GET /api/work_orders?equipment_instance_id=&subsystem_id=&status=
### GET /api/work_orders/:id (含 operations / qc / welds)
### POST /api/work_orders
Body: wo_code / equipment_instance_id / milestone_id / subsystem_id / parent_wo_id / title / description / workstation_id / priority / planned_start / planned_end / estimated_hours
### PUT /api/work_orders/:id
### POST /api/work_orders/:id/operations (扫码报工)
action: start / pause / resume / complete / note
自动联动 status

---

## 🔧 焊接 / 探伤 / 装配 (追溯)

### POST /api/work_orders/:id/welds
Body: weld_no / weld_type / welder_id / material_lot_id / welding_procedure / weld_length_mm
### GET /api/work_orders/:id/welds
### POST /api/work_orders/:id/ndt
### POST /api/work_orders/:id/assembly
Body: step_no / step_name / operator_id / torque_value_nm / clearance_mm / notes / photos

---

## 📦 物料

### GET /api/materials?is_key_component=&is_self_made=
### POST /api/materials
### GET /api/key_components
### GET /api/key_components/long_leadtime (≥12 周)

---

## 🔄 设计变更 (ECO)

### GET /api/equipment_instances/:id/eco
### POST /api/equipment_instances/:id/eco
Body: eco_no / title / reason / affected_scope / created_by

---

## 🔧 现场服务

### GET /api/field_service?equipment_instance_id=&status=
### POST /api/field_service
Body: equipment_instance_id / service_type (assembly/commissioning/warranty/repair) / title / description / priority / assigned_to

---

## 📄 出厂资料

### GET /api/equipment_instances/:id/documents
### POST /api/equipment_instances/:id/documents
Body: doc_type / doc_name / doc_no / file_path / file_size / uploaded_by / notes
(文件走文件系统, DB 只存元数据)

---

## 👤 用户 / 角色

### GET /api/users
### GET /api/roles

---

## 📊 错误码

| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 400 | 参数错误 |
| 401 | 未登录或 token 无效 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 500 | 服务器错误 |

---

## 🏗️ 数据模型 (25 张表)

### 主数据
- equipment_types / equipment_models / equipment_subsystems / workstations / equipment

### 实例 ★
- equipment_instances / instance_specs / instance_bom / instance_eco / instance_milestones

### 执行 ★
- work_orders / work_order_operations / work_order_qc / weld_records / ndt_records / assembly_records

### 物料
- materials / material_lots / key_components / inventory

### 质量/服务
- qc_inspections / documents / field_service / feedback

### 用户/权限
- users / roles

---

## 🚀 典型流程

1. 登录拿 token
2. 创建实例 (选型号 → 自动 S1)
3. 自动生成 S1-S10 里程碑
4. 导入/编辑 BOM (5 级)
5. 创建工单 (按里程碑分派)
6. 工人扫码报工 (开始/暂停/完成)
7. 录入焊缝 + 探伤
8. 录入装配
9. 客户/厂内文档登记
10. 现场服务工单 (S8+)

---

**最后更新**: 2026-06-18
