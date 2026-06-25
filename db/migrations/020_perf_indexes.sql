-- 020_perf_indexes.sql
-- P1-3 性能索引: 高频过滤/排序字段
-- Author: 三狗子 | Date: 2026-06-25

-- material_movements: 移动记录分页/过滤 (按 lot/wo/project/时间)
CREATE INDEX IF NOT EXISTS idx_mm_lot_created ON material_movements(material_lot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mm_work_order ON material_movements(work_order_id) WHERE work_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mm_project ON material_movements(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mm_type_created ON material_movements(movement_type, created_at DESC);

-- inventory: 按 lot + location 查
CREATE INDEX IF NOT EXISTS idx_inv_lot_loc ON inventory(material_lot_id, location);
CREATE INDEX IF NOT EXISTS idx_inv_status ON inventory(status) WHERE status != 'available';

-- material_lots: 按 material_id + 收到时间
CREATE INDEX IF NOT EXISTS idx_ml_material_received ON material_lots(material_id, received_date DESC);

-- work_orders: 按 status 过滤 + 排序 (无 project_id 列, 改用 equipment_instance_id)
CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wo_instance ON work_orders(equipment_instance_id) WHERE equipment_instance_id IS NOT NULL;

-- process_nodes: 按 instance + subsystem 查
CREATE INDEX IF NOT EXISTS idx_pn_instance ON process_nodes(equipment_instance_id);
CREATE INDEX IF NOT EXISTS idx_pn_subsystem ON process_nodes(subsystem_id) WHERE subsystem_id IS NOT NULL;

-- equipment_instances: 按 status + 客户查询
CREATE INDEX IF NOT EXISTS idx_ei_status ON equipment_instances(status);
CREATE INDEX IF NOT EXISTS idx_ei_customer ON equipment_instances(customer_name) WHERE customer_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ei_model ON equipment_instances(equipment_model_id) WHERE equipment_model_id IS NOT NULL;

-- purchase_orders: 按 supplier + status
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_instance ON purchase_orders(equipment_instance_id) WHERE equipment_instance_id IS NOT NULL;

-- po_lines: 按 po_id + material
CREATE INDEX IF NOT EXISTS idx_pol_po ON po_lines(po_id);
CREATE INDEX IF NOT EXISTS idx_pol_material ON po_lines(material_id);

-- users: 按 username 登录查询
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- key_component_prices: 按 component + effective date
CREATE INDEX IF NOT EXISTS idx_kcp_component_date ON key_component_prices(key_component_id, valid_from DESC);
