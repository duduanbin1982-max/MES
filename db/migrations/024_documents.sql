-- 024_documents.sql
-- P0 第 1 件: 文档/图纸管理 (PLM 基础) - 升级老的 10 字段 documents 表
--   老 schema (002 创建): id, equipment_instance_id, doc_type, doc_name, doc_no, file_path, file_size, uploaded_by, uploaded_at, notes
--   新增字段: bom_node_id, eco_id, doc_code, title, version, file_name, mime_type, file_hash,
--             status, issued_to, issued_at, issued_by, revoke_reason, revoked_at, description, tags, created_by, updated_at
--   老字段映射: doc_name -> title (新建时), doc_no -> doc_code, uploaded_at -> created_at
-- Author: 三狗子 | Date: 2026-06-25

-- 1) 加列 (SQLite 支持多次 ADD COLUMN)
ALTER TABLE documents ADD COLUMN bom_node_id INTEGER;
ALTER TABLE documents ADD COLUMN eco_id INTEGER;
ALTER TABLE documents ADD COLUMN doc_code TEXT;
ALTER TABLE documents ADD COLUMN version TEXT DEFAULT 'A0';
ALTER TABLE documents ADD COLUMN file_name TEXT;
ALTER TABLE documents ADD COLUMN mime_type TEXT;
ALTER TABLE documents ADD COLUMN file_hash TEXT;
ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE documents ADD COLUMN issued_to TEXT;
ALTER TABLE documents ADD COLUMN issued_at TEXT;
ALTER TABLE documents ADD COLUMN issued_by INTEGER;
ALTER TABLE documents ADD COLUMN revoke_reason TEXT;
ALTER TABLE documents ADD COLUMN revoked_at TEXT;
ALTER TABLE documents ADD COLUMN description TEXT;
ALTER TABLE documents ADD COLUMN tags TEXT;
ALTER TABLE documents ADD COLUMN updated_at TEXT;
ALTER TABLE documents ADD COLUMN title TEXT;

-- 2) 兼容老数据: doc_name -> title, doc_no -> doc_code, uploaded_at -> created_at
UPDATE documents SET title = doc_name WHERE title IS NULL AND doc_name IS NOT NULL;
UPDATE documents SET doc_code = doc_no WHERE doc_code IS NULL AND doc_no IS NOT NULL;
UPDATE documents SET file_name = file_path WHERE file_name IS NULL AND file_path IS NOT NULL;

-- 3) 索引
CREATE INDEX IF NOT EXISTS idx_doc_instance ON documents(equipment_instance_id);
CREATE INDEX IF NOT EXISTS idx_doc_bom_node ON documents(bom_node_id);
CREATE INDEX IF NOT EXISTS idx_doc_eco ON documents(eco_id) WHERE eco_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_type_status ON documents(doc_type, status);
CREATE INDEX IF NOT EXISTS idx_doc_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_doc_code ON documents(doc_code) WHERE doc_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_hash ON documents(file_hash);