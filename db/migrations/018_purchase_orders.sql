-- 018_purchase_orders.sql
-- 采购订单模块 (P1-#4 业务闭环)
-- 业务背景:
--   materialAlerts 提示"立即下单", 但目前没有 PO 表记录到货计划 / 供应商 / 合同价
--   这次新增 suppliers + purchase_orders + po_lines 三张表
--   PO 收货时自动入库 (走 P0-#3 receive_lot) + 写 key_component_prices (实际合同价, 覆盖 015 的 unit_price 估计)
--
-- Author: 三狗子 | Date: 2026-06-25

PRAGMA foreign_keys = ON;

-- 供应商
CREATE TABLE IF NOT EXISTS suppliers (
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
);

-- 采购订单主表
CREATE TABLE IF NOT EXISTS purchase_orders (
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

-- 采购订单明细
CREATE TABLE IF NOT EXISTS po_lines (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id               INTEGER NOT NULL,
  material_id         INTEGER NOT NULL,
  quantity            REAL NOT NULL,
  unit                TEXT,
  unit_price          REAL NOT NULL,
  line_amount         REAL NOT NULL,              -- quantity * unit_price
  expected_date       TEXT,
  received_qty        REAL DEFAULT 0,            -- 累计收货
  lot_no_at_receipt   TEXT,                       -- 收货时实际 lot_no (后填)
  notes               TEXT,
  line_no             INTEGER NOT NULL,           -- 行号, 1-based
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id)
);

CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_expected ON purchase_orders(expected_date);
CREATE INDEX IF NOT EXISTS idx_po_lines_po ON po_lines(po_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_material ON po_lines(material_id);