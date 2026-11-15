-- 2026-11-15 备件库存统一：TPM 通用备件关联物料主数据
ALTER TABLE equipment_spare_parts ADD COLUMN material_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_equipment_spare_material ON equipment_spare_parts(material_id);
UPDATE equipment_spare_parts
   SET material_id = (SELECT m.id FROM materials m WHERE m.material_code = equipment_spare_parts.part_code)
 WHERE material_id IS NULL;
