-- 2026-11-15 采购申请审批与转采购订单
ALTER TABLE purchase_requisitions ADD COLUMN submitted_at TEXT;
ALTER TABLE purchase_requisitions ADD COLUMN submitted_by INTEGER;
ALTER TABLE purchase_requisitions ADD COLUMN approved_at TEXT;
ALTER TABLE purchase_requisitions ADD COLUMN approved_by INTEGER;
ALTER TABLE purchase_requisitions ADD COLUMN rejected_at TEXT;
ALTER TABLE purchase_requisitions ADD COLUMN rejected_by INTEGER;
ALTER TABLE purchase_requisitions ADD COLUMN reject_reason TEXT;
ALTER TABLE purchase_requisitions ADD COLUMN converted_at TEXT;
ALTER TABLE purchase_requisition_items ADD COLUMN supplier_id INTEGER;
ALTER TABLE purchase_requisition_items ADD COLUMN unit_price REAL DEFAULT 0;
CREATE TABLE IF NOT EXISTS purchase_requisition_po_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id INTEGER NOT NULL,
  po_id INTEGER NOT NULL,
  po_no TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pr_id, po_id)
);
CREATE INDEX IF NOT EXISTS idx_pr_po_pr ON purchase_requisition_po_links(pr_id);
