"use strict";
// services/purchase/suppliers.js 的 register() 前置逻辑（AST 版拆分）

const { makeHelpers } = require('../_helpers')

module.exports = function createContext(app, db, deps) {
  const { BOOTSTRAP_TEMPLATES, REQUIRED_SUPPLIER_CATEGORIES, SUPPLIER_CATEGORIES, buildSetupSummary, categoryLabel, nextSupplierCode, safeJson } = deps;
const { all, get, run } = makeHelpers(db)
function cols() {
    return new Set(db.prepare('PRAGMA table_info(suppliers)').all().map((c) => c.name));
  }
function addColumn(name, ddl) {
    if (!cols().has(name)) db.prepare(`ALTER TABLE suppliers ADD COLUMN ${ddl}`).run();
  }
addColumn('supplier_category', "supplier_category TEXT DEFAULT 'general'");
addColumn('business_categories', 'business_categories TEXT');
addColumn('is_key_supplier', 'is_key_supplier INTEGER DEFAULT 0');
addColumn('is_outsource_supplier', 'is_outsource_supplier INTEGER DEFAULT 0');
addColumn('is_standard_supplier', 'is_standard_supplier INTEGER DEFAULT 0');
addColumn('category_notes', 'category_notes TEXT');
db.prepare('CREATE INDEX IF NOT EXISTS idx_suppliers_category ON suppliers(supplier_category)').run();
const seedRows = all("SELECT * FROM suppliers WHERE supplier_category IS NULL OR supplier_category = '' OR business_categories IS NULL");
const updateSeed = db.prepare("UPDATE suppliers SET supplier_category = COALESCE(NULLIF(supplier_category, ''), ?), business_categories = COALESCE(business_categories, ?), is_key_supplier = ?, is_outsource_supplier = ?, is_standard_supplier = ? WHERE id = ?");
for (const row of seedRows) {
    const category = inferCategory(row);
    const categories = [category];
    updateSeed.run(
      category,
      JSON.stringify(categories),
      category === 'key_component' ? 1 : 0,
      category === 'outsourcing' ? 1 : 0,
      category === 'standard_part' ? 1 : 0,
      row.id
    );
  }
function decorate(row) {
    if (!row) return row;
    const businessCategories = safeJson(row.business_categories, row.supplier_category ? [row.supplier_category] : []);
    return {
      ...row,
      business_categories: businessCategories,
      supplier_category_label: categoryLabel(row.supplier_category),
      business_category_labels: businessCategories.map(categoryLabel),
    };
  }

  return { BOOTSTRAP_TEMPLATES, REQUIRED_SUPPLIER_CATEGORIES, SUPPLIER_CATEGORIES, addColumn, all, buildSetupSummary, categoryLabel, cols, decorate, get, nextSupplierCode, run, safeJson, seedRows, updateSeed };
};
