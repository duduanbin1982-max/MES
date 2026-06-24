-- ============================================================
-- 005_relax_tbm_specific_columns.sql
-- equipment_models: TBM 专属字段改为可空 (支持多产品线)
-- Author: 三狗子 | Date: 2026-06-18
-- ============================================================

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE equipment_models_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_type_id INTEGER REFERENCES equipment_types(id),
  model_code TEXT UNIQUE NOT NULL,
  model_name TEXT NOT NULL,
  diameter_mm INTEGER,                    -- TBM 专属,其他可空
  tbm_type TEXT,                            -- TBM 专属 (epb/slurry/composite)
  designed_thrust_kn INTEGER,
  designed_torque_knm INTEGER,
  installed_power_kw INTEGER,
  spec_json TEXT,                           -- 通用规格 JSON (灵活扩展)
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO equipment_models_new
  (id, equipment_type_id, model_code, model_name, diameter_mm, tbm_type,
   designed_thrust_kn, designed_torque_knm, installed_power_kw,
   description, created_at, updated_at)
SELECT id, equipment_type_id, model_code, model_name, diameter_mm, tbm_type,
   designed_thrust_kn, designed_torque_knm, installed_power_kw,
   description, created_at, updated_at
FROM equipment_models;

DROP TABLE equipment_models;
ALTER TABLE equipment_models_new RENAME TO equipment_models;

CREATE INDEX IF NOT EXISTS idx_equipment_models_type ON equipment_models(equipment_type_id);

COMMIT;
PRAGMA foreign_keys = ON;

SELECT '005 done' as status;