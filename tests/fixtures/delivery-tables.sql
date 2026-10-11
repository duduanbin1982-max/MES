-- tests/fixtures/delivery-tables.sql
-- 由 .tmp/gen-delivery-fixture.js 从生产库 data/mes.db 导出（仅表结构，无数据）。
-- 目的：delivery/readModel 的等价性测试使用真实列名与约束，而不是手抄最小表。
-- 重新生成：node .tmp/gen-delivery-fixture.js
CREATE TABLE "equipment_instances" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_code TEXT UNIQUE NOT NULL,
  instance_name TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_contact TEXT,
  site_location TEXT,
  contract_no TEXT,
  equipment_model_id INTEGER REFERENCES equipment_models(id),
  start_date TEXT,
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  status TEXT NOT NULL DEFAULT 'design',
  progress_pct REAL DEFAULT 0,
  contract_amount REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  lifecycle_stage TEXT,
  serial_no TEXT
, contract_amount_unit TEXT NOT NULL DEFAULT 'wan'
  CHECK (contract_amount_unit IN ('yuan', 'wan')), project_no TEXT, archive_status TEXT DEFAULT 'active', archived_at TEXT, archived_by INTEGER, frozen_at TEXT, frozen_by INTEGER, freeze_snapshot TEXT, source_template_id INTEGER);

CREATE INDEX idx_ei_customer ON equipment_instances(customer_name) WHERE customer_name IS NOT NULL;

CREATE INDEX idx_ei_model ON equipment_instances(equipment_model_id) WHERE equipment_model_id IS NOT NULL;

CREATE INDEX idx_ei_status ON equipment_instances(status);

CREATE INDEX idx_equipment_instances_project_no ON equipment_instances(project_no);

CREATE INDEX idx_equipment_instances_archive_status ON equipment_instances(archive_status);

CREATE TABLE project_cost_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        equipment_instance_id INTEGER NOT NULL,
        bom_node_id INTEGER,
        work_order_id INTEGER,
        cost_type TEXT NOT NULL CHECK (cost_type IN ('material','labor','outsourcing','depreciation','rework','quality_loss')),
        source_type TEXT,
        source_ref TEXT,
        description TEXT NOT NULL,
        vendor TEXT,
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'CNY',
        occurred_on TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','void')),
        notes TEXT,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      );

CREATE INDEX idx_project_cost_entries_instance ON project_cost_entries(equipment_instance_id, deleted_at);

CREATE INDEX idx_project_cost_entries_type ON project_cost_entries(cost_type, status);

CREATE INDEX idx_project_cost_entries_bom ON project_cost_entries(bom_node_id);

CREATE INDEX idx_project_cost_entries_work_order ON project_cost_entries(work_order_id);

CREATE TABLE erp_cost_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_no TEXT NOT NULL UNIQUE,
      entry_date TEXT NOT NULL DEFAULT (date('now')),
      gl_account_code TEXT NOT NULL,
      equipment_instance_id INTEGER, work_order_id INTEGER,
      purchase_order_id INTEGER, material_id INTEGER,
      description TEXT,
      debit_amount REAL NOT NULL DEFAULT 0,
      credit_amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      source_type TEXT NOT NULL, source_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      exported_at TEXT, erp_ref TEXT, notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE INDEX idx_erp_ledger_date ON erp_cost_ledger(entry_date);

CREATE INDEX idx_erp_ledger_status ON erp_cost_ledger(status);

CREATE INDEX idx_erp_ledger_inst ON erp_cost_ledger(equipment_instance_id);

CREATE INDEX idx_erp_ledger_gl ON erp_cost_ledger(gl_account_code);

CREATE TABLE acceptance_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      checklist_name TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      inspector TEXT,
      customer_rep TEXT,
      result TEXT,
      issues TEXT,
      sign_date TEXT,
      signature_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE INDEX idx_acl_inst ON acceptance_checklists(equipment_instance_id);

CREATE TABLE shortage_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_order_id INTEGER NOT NULL,
        equipment_instance_id INTEGER,
        material_id INTEGER NOT NULL,
        shortage_qty REAL NOT NULL,
        required_qty REAL,
        available_qty REAL,
        unit TEXT,
        status TEXT DEFAULT 'open',
        owner_id INTEGER,
        owner_name TEXT,
        expected_date TEXT,
        purchase_request_no TEXT,
        priority TEXT DEFAULT 'normal',
        last_note TEXT,
        closed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(work_order_id, material_id)
      );

CREATE INDEX idx_shortage_cases_status ON shortage_cases(status);

CREATE INDEX idx_shortage_cases_wo ON shortage_cases(work_order_id);

CREATE TABLE ncr_reports (
    id INTEGER PRIMARY KEY,
    ncr_code TEXT UNIQUE,
    source_type TEXT,
    source_id INTEGER,
    equipment_instance_id INTEGER,
    part_name TEXT,
    defect_desc TEXT NOT NULL,
    defect_qty INTEGER,
    severity TEXT DEFAULT 'minor',
    disposition TEXT DEFAULT 'pending',
    disposition_by INTEGER,
    disposition_at TEXT,
    root_cause TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    closed_at TEXT
  );

CREATE TABLE capa_actions (
    id INTEGER PRIMARY KEY,
    ncr_id INTEGER,
    action_type TEXT NOT NULL,
    action_desc TEXT NOT NULL,
    assigned_to INTEGER,
    due_date TEXT,
    status TEXT DEFAULT 'open',
    completed_at TEXT,
    verified_by INTEGER,
    verified_at TEXT,
    effectiveness TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

CREATE TABLE ncr_rechecks (
    id INTEGER PRIMARY KEY,
    ncr_id INTEGER NOT NULL,
    result TEXT NOT NULL,
    inspector_id INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

CREATE TABLE oee_shift_log (
      id INTEGER PRIMARY KEY,
      equipment_instance_id INTEGER,
      shift_date TEXT,
      shift_name TEXT,
      planned_minutes REAL,
      operating_minutes REAL,
      ideal_cycle_time REAL,
      total_output INTEGER,
      good_output INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

CREATE INDEX idx_oee_shift_instance ON oee_shift_log(equipment_instance_id);

CREATE INDEX idx_oee_shift_date ON oee_shift_log(shift_date);

CREATE TABLE materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_code TEXT UNIQUE NOT NULL,
  material_name TEXT NOT NULL,
  material_type TEXT,                          -- steel / bought_part / standard_part
  spec TEXT,
  unit TEXT DEFAULT 'pcs',
  is_key_component INTEGER DEFAULT 0,
  is_self_made INTEGER DEFAULT 0,              -- 自制/外购
  default_supplier TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, safety_stock REAL NOT NULL DEFAULT 0, reorder_point REAL NOT NULL DEFAULT 0, estimated_unit_price REAL NOT NULL DEFAULT 0, actual_unit_price REAL NOT NULL DEFAULT 0);

CREATE TABLE work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_code TEXT UNIQUE NOT NULL,                -- WO-TBM2026001-S3-001
  equipment_instance_id INTEGER NOT NULL,
  milestone_id INTEGER,
  subsystem_id INTEGER,
  parent_wo_id INTEGER,                        -- 上级工单
  title TEXT NOT NULL,
  description TEXT,
  workstation_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending/assigned/in_progress/paused/completed/issue/rework
  priority INTEGER DEFAULT 3,                  -- 1-5
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  estimated_hours REAL,
  actual_hours REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), assigned_to INTEGER REFERENCES users(id), dispatched_at TEXT, quantity_planned INTEGER DEFAULT 1, quantity_completed INTEGER DEFAULT 0,
  FOREIGN KEY (equipment_instance_id) REFERENCES "equipment_instances"(id) ON DELETE CASCADE,
  FOREIGN KEY (milestone_id) REFERENCES "instance_milestones"(id),
  FOREIGN KEY (subsystem_id) REFERENCES "equipment_subsystems"(id),
  FOREIGN KEY (parent_wo_id) REFERENCES work_orders(id),
  FOREIGN KEY (workstation_id) REFERENCES workstations(id)
);

CREATE INDEX idx_work_orders_subsystem ON work_orders(subsystem_id);

CREATE INDEX idx_wo_status ON work_orders(status);

CREATE INDEX idx_wo_instance ON work_orders(equipment_instance_id) WHERE equipment_instance_id IS NOT NULL;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  full_name TEXT NOT NULL,
  role_id INTEGER,
  phone TEXT,
  cert_no TEXT,                                -- 焊工证号等
  cert_type TEXT,                              -- welder / qc / operator
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login TEXT, role_code TEXT DEFAULT NULL, workstation_id INTEGER REFERENCES workstations(id), availability TEXT DEFAULT 'offline', skills TEXT, role_group_id INTEGER,
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE INDEX idx_users_role_code ON users(role_code);

CREATE INDEX idx_users_username ON users(username);

CREATE TABLE purchase_orders (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  po_no               TEXT UNIQUE NOT NULL,      -- PO-2026-001
  supplier_id         INTEGER NOT NULL,
  equipment_instance_id INTEGER,                 -- 关联项目 (可选, 通用备货可空)
  status              TEXT NOT NULL DEFAULT 'draft',  -- draft/submitted/confirmed/in_transit/partially_received/received/closed/cancelled
  ordered_date        TEXT,                       -- 下单日
  expected_date       TEXT,                       -- 预计到货
  subtotal            REAL DEFAULT 0,
  tax_amount          REAL DEFAULT 0,
  total_amount        REAL DEFAULT 0,
  currency            TEXT DEFAULT 'CNY',
  payment_terms       TEXT,
  created_by          INTEGER,
  approved_by         INTEGER,
  approved_at         TEXT,
  closed_at           TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id)
);

CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);

CREATE INDEX idx_po_status ON purchase_orders(status);

CREATE INDEX idx_po_expected ON purchase_orders(expected_date);

CREATE INDEX idx_po_instance ON purchase_orders(equipment_instance_id) WHERE equipment_instance_id IS NOT NULL;

CREATE TABLE purchase_order_items (id INTEGER PRIMARY KEY, po_id INTEGER, material_id INTEGER, bom_node_id INTEGER, quantity REAL, unit TEXT, unit_price REAL, total_price REAL, received_qty REAL DEFAULT 0, notes TEXT);

CREATE TABLE purchase_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_order_id INTEGER NOT NULL,
      item_name TEXT,
      supplier TEXT,
      order_date TEXT,
      planned_delivery TEXT,
      actual_delivery TEXT,
      delay_days INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      urgent_tags TEXT,
      remarks TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    , owner_id INTEGER, owner_name TEXT, linked_shortage_count INTEGER DEFAULT 0, linked_work_order_count INTEGER DEFAULT 0, source_type TEXT DEFAULT 'purchase_order', source_ref_id INTEGER, equipment_instance_id INTEGER, material_id INTEGER, purchase_request_no TEXT, linked_shortage_ids TEXT, linked_work_order_ids TEXT, risk_level TEXT);

CREATE INDEX idx_pt_status ON purchase_tracking(status);

CREATE INDEX idx_pt_delay ON purchase_tracking(delay_days);

CREATE INDEX idx_pt_source ON purchase_tracking(source_type, source_ref_id);

CREATE INDEX idx_pt_instance ON purchase_tracking(equipment_instance_id, status);

CREATE TABLE suppliers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_code   TEXT UNIQUE NOT NULL,         -- SUP-001
  supplier_name   TEXT NOT NULL,
  contact_person  TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  payment_terms   TEXT,                          -- 30天月结 / 货到付款
  rating          TEXT DEFAULT 'B',              -- A/B/C/D
  is_active       INTEGER DEFAULT 1,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
, supplier_category TEXT DEFAULT 'general', business_categories TEXT, is_key_supplier INTEGER DEFAULT 0, is_outsource_supplier INTEGER DEFAULT 0, is_standard_supplier INTEGER DEFAULT 0, category_notes TEXT);

CREATE INDEX idx_suppliers_active ON suppliers(is_active);

CREATE INDEX idx_suppliers_category ON suppliers(supplier_category);

CREATE TABLE "instance_eco" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_instance_id INTEGER NOT NULL,
  eco_no TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT,
  affected_scope TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  effective_date TEXT,
  closed_date TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id) ON DELETE CASCADE
);

CREATE INDEX idx_instance_eco_instance ON instance_eco(equipment_instance_id);

CREATE INDEX idx_instance_eco_status ON instance_eco(status);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_instance_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,                      -- certificate / material_cert / drawing / manual / report
  doc_name TEXT NOT NULL,
  doc_no TEXT,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  uploaded_by INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT, bom_node_id INTEGER, eco_id INTEGER, doc_code TEXT, version TEXT DEFAULT 'A0', file_name TEXT, mime_type TEXT, file_hash TEXT, status TEXT NOT NULL DEFAULT 'draft', issued_to TEXT, issued_at TEXT, issued_by INTEGER, revoke_reason TEXT, revoked_at TEXT, description TEXT, tags TEXT, updated_at TEXT, title TEXT,
  FOREIGN KEY (equipment_instance_id) REFERENCES "equipment_instances"(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE INDEX idx_doc_instance ON documents(equipment_instance_id);

CREATE INDEX idx_doc_bom_node ON documents(bom_node_id);

CREATE INDEX idx_doc_eco ON documents(eco_id) WHERE eco_id IS NOT NULL;

CREATE INDEX idx_doc_type_status ON documents(doc_type, status);

CREATE INDEX idx_doc_status ON documents(status);

CREATE INDEX idx_doc_code ON documents(doc_code) WHERE doc_code IS NOT NULL;

CREATE INDEX idx_doc_hash ON documents(file_hash);

CREATE TABLE instance_bom (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 归属
  equipment_instance_id INTEGER NOT NULL,
  parent_id INTEGER,                       -- NULL = 根 (0 级总装)

  -- 层级与版本 (新)
  tier INTEGER NOT NULL DEFAULT 2,         -- 0 总装 / 1 部件 / 2 零件 / 3 毛坯 (文章 4 级)
  version TEXT DEFAULT 'A0',               -- A0/A1/B0 (图版号)
  eco_id INTEGER,                          -- 关联设计变更
  effective_from TEXT,                     -- 生效起始
  effective_to TEXT,                       -- 生效截止 (NULL = 长期)

  -- 物料引用 (强一致: 跨 BOM 共用同一物料)
  material_id INTEGER,                     -- 关联 materials.id (NULL = 虚项/虚拟件)
  part_number TEXT,                        -- 图号/型号 (外购件: 官方型号如 CDQ2B63-100DZ; 自制件: 内部图号)

  -- 数量属性
  quantity REAL NOT NULL DEFAULT 1,        -- 单台净用量
  unit TEXT DEFAULT '件',                  -- 件/个/米/千克/套
  scrap_factor REAL DEFAULT 1.0,           -- 损耗系数 (EBOM 净用量 × scrap = MBOM 实际采购量, 默认 1.0)

  -- 物料分类 (新, 7 大类)
  category TEXT,                           -- 自制机加件/自制钣金件/标准紧固件/气动元件/电气元件/外购成品/辅助材料

  -- 技术要求 (新)
  material_grade TEXT,                     -- 材质牌号: 45钢/Q235B/6061-T6/304不锈钢/8.8级碳钢
  surface_treatment TEXT,                  -- 表面处理: 调质HB220-250/阳极氧化/喷塑RAL7035/发黑/镀锌
  brand_recommend TEXT,                    -- 推荐品牌: SMC/亚德客/东明/--  (A 级 / B 级 / "不可替代")
  brand_grade TEXT,                        -- A/B/不可替代

  -- 替代料 (新: 加 priority)
  is_alternative INTEGER DEFAULT 0,
  alternative_group TEXT,                  -- 同组互替
  alternative_priority INTEGER DEFAULT 1,  -- 同组内优先级: 1=首选, 2=次选

  -- 工艺关联 (新)
  operation_id INTEGER,                    -- 关联 process_tree_node.id (这道零件在哪道工序消耗)
  is_phantom INTEGER DEFAULT 0,            -- 虚项: 不出现在库存/MRP, 只用于结构展示

  -- 关键性/易损
  is_key_component INTEGER DEFAULT 0,
  is_wear_part INTEGER DEFAULT 0,          -- 易损件 (售后备件用)
  storage_location TEXT,                   -- 存放位置 (库位/柜号)

  -- 成本 (冗余, 加速汇总)
  unit_price REAL,                         -- 估价 (来自 materials.unit_price, 冗余以便成本汇总)
  weight REAL,                             -- 单重 (kg)

  -- 管理追溯
  notes TEXT,                              -- 备注: "左件/右件/与XX配作/不可替代/现场加工"
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT, node_type TEXT, level_code TEXT, sort_order INTEGER DEFAULT 0, view_flags TEXT,

  FOREIGN KEY (parent_id) REFERENCES instance_bom(id),
  FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id),
  FOREIGN KEY (material_id) REFERENCES materials(id),
  FOREIGN KEY (eco_id) REFERENCES instance_eco(id)
);

CREATE INDEX idx_bom_instance ON instance_bom(equipment_instance_id, tier);

CREATE INDEX idx_bom_parent ON instance_bom(parent_id);

CREATE INDEX idx_bom_material ON instance_bom(material_id);

CREATE INDEX idx_bom_eco ON instance_bom(eco_id) WHERE eco_id IS NOT NULL;

CREATE INDEX idx_bom_effective ON instance_bom(effective_from, effective_to);

CREATE INDEX idx_bom_version ON instance_bom(equipment_instance_id, version);

CREATE INDEX idx_instance_bom_parent_sort ON instance_bom(equipment_instance_id, parent_id, sort_order, id);

CREATE INDEX idx_instance_bom_level_code ON instance_bom(equipment_instance_id, level_code);

CREATE INDEX idx_instance_bom_node_type ON instance_bom(equipment_instance_id, node_type);

CREATE TABLE "process_nodes" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_instance_id INTEGER NOT NULL,
  parent_id INTEGER,
  bom_node_id INTEGER,
  operation_name TEXT NOT NULL,
  operation_type TEXT DEFAULT 'make',
  sequence INTEGER DEFAULT 1,
  estimated_hours REAL DEFAULT 0,
  required_workstation_id INTEGER,
  required_skill TEXT,
  required_materials TEXT,
  is_milestone INTEGER DEFAULT 0,
  phase_code TEXT,
  status TEXT DEFAULT 'pending',
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  planned_cost REAL DEFAULT 0,
  actual_cost REAL DEFAULT 0,
  auto_unblock INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  assigned_to INTEGER,
  subsystem_id INTEGER, operation_template_id INTEGER, required_position_code TEXT, worker_count INTEGER DEFAULT 1, qc_required INTEGER DEFAULT 0, sop_required INTEGER DEFAULT 0, drawing_required INTEGER DEFAULT 0,
  FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES process_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (bom_node_id) REFERENCES instance_bom(id) ON DELETE SET NULL,
  FOREIGN KEY (required_workstation_id) REFERENCES workstations(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (subsystem_id) REFERENCES equipment_subsystems(id) ON DELETE SET NULL
);

CREATE INDEX idx_pn_instance ON process_nodes(equipment_instance_id);

CREATE INDEX idx_pn_parent ON process_nodes(parent_id);

CREATE INDEX idx_pn_status ON process_nodes(status);

CREATE INDEX idx_pn_bom ON process_nodes(bom_node_id);

CREATE INDEX idx_pn_subsystem ON process_nodes(subsystem_id);

CREATE INDEX idx_process_nodes_template ON process_nodes(operation_template_id);

CREATE TABLE "qc_inspections" (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, work_order_id INTEGER, inspection_type TEXT NOT NULL, result TEXT NOT NULL, inspector_id INTEGER, inspection_date TEXT NOT NULL DEFAULT (datetime('now')), notes TEXT);

CREATE TABLE andon_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER,
    alert_type TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id INTEGER,
    title TEXT NOT NULL,
    message TEXT,
    severity TEXT NOT NULL DEFAULT "warning",
    status TEXT NOT NULL DEFAULT "open",
    triggered_by TEXT,
    acknowledged_by INTEGER,
    acknowledged_at TEXT,
    resolved_by INTEGER,
    resolved_at TEXT,
    resolution_note TEXT,
    data_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (rule_id) REFERENCES andon_rules(id) ON DELETE SET NULL,
    FOREIGN KEY (acknowledged_by) REFERENCES users(id),
    FOREIGN KEY (resolved_by) REFERENCES users(id)
  );

CREATE INDEX idx_andon_status ON andon_alerts(status);

CREATE INDEX idx_andon_severity ON andon_alerts(severity);

CREATE INDEX idx_andon_source ON andon_alerts(source_type, source_id);

CREATE INDEX idx_andon_created ON andon_alerts(created_at);

CREATE TABLE inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_lot_id INTEGER NOT NULL,
  location TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT,
  status TEXT DEFAULT 'available',             -- available/allocated/used/quarantined
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (material_lot_id) REFERENCES material_lots(id)
);

CREATE INDEX idx_inventory_lot ON inventory(material_lot_id);

CREATE INDEX idx_inv_lot_loc ON inventory(material_lot_id, location);

CREATE INDEX idx_inv_status ON inventory(status) WHERE status != 'available';

CREATE TABLE work_order_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  operator_id INTEGER,
  action TEXT NOT NULL,                        -- start/pause/resume/complete/note
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  hours_worked REAL,
  notes TEXT,
  photos TEXT, quantity_completed INTEGER DEFAULT 0, defect_quantity INTEGER DEFAULT 0,                                 -- JSON 数组, 文件路径
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_id) REFERENCES users(id)
);

CREATE INDEX idx_wo_ops_wo ON work_order_operations(work_order_id);

CREATE INDEX idx_wo_ops_operator ON work_order_operations(operator_id);
