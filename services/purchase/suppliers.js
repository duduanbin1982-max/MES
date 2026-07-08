// services/purchase/suppliers.js
// 供应商 CRUD + 分类治理

const { makeHelpers } = require('./_helpers')
const { wrap } = require('../../middleware/asyncHandler');
const { ApiError } = require('../../app/errors');

const SUPPLIER_CATEGORIES = [
  { value: 'key_component', label: '关键件供应商', description: '主轴承、刀盘、液压、电气等关键件' },
  { value: 'outsourcing', label: '外协供应商', description: '机加工、热处理、喷涂、焊接外协等' },
  { value: 'standard_part', label: '标准件供应商', description: '紧固件、轴承、密封件、通用件等' },
  { value: 'raw_material', label: '原材料供应商', description: '钢板、型材、棒料、焊材等' },
  { value: 'service', label: '服务类供应商', description: '运输、检测、安装、维保等' },
  { value: 'general', label: '普通供应商', description: '未明确分类的供应商' },
];

const REQUIRED_SUPPLIER_CATEGORIES = ['key_component', 'outsourcing', 'standard_part'];

const BOOTSTRAP_TEMPLATES = [
  {
    category: 'key_component',
    code_prefix: 'SUP-KEY',
    supplier_name: '关键件示例供应商',
    contact_person: '关键件采购接口人',
    category_notes: '适用于主轴承、液压、电气、刀盘等关键件首日建档',
    rating: 'A',
  },
  {
    category: 'outsourcing',
    code_prefix: 'SUP-OUT',
    supplier_name: '外协加工示例供应商',
    contact_person: '外协跟单接口人',
    category_notes: '适用于机加工、热处理、喷涂、焊接外协等首日建档',
    rating: 'B',
  },
  {
    category: 'standard_part',
    code_prefix: 'SUP-STD',
    supplier_name: '标准件示例供应商',
    contact_person: '标准件采购接口人',
    category_notes: '适用于紧固件、轴承、密封件、通用标准件首日建档',
    rating: 'B',
  },
];

function safeJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return String(value).split(/[,\uFF0C;；、]/).map((x) => x.trim()).filter(Boolean);
  }
}

function jsonText(value) {
  return JSON.stringify(safeJson(value));
}

function inferCategory(row) {
  const text = `${row.supplier_code || ''} ${row.supplier_name || ''} ${row.notes || ''}`.toLowerCase();
  if (/外协|加工|热处理|喷涂|outsourc|machine|coating|heat/.test(text)) return 'outsourcing';
  if (/标准|紧固|螺栓|轴承|密封|standard|bearing|bolt/.test(text)) return 'standard_part';
  if (/关键|主轴承|刀盘|液压|电气|key|critical|hydraulic/.test(text)) return 'key_component';
  if (/钢|板材|型材|原材料|焊材|raw|steel/.test(text)) return 'raw_material';
  return 'general';
}

function categoryLabel(category) {
  return SUPPLIER_CATEGORIES.find((item) => item.value === category)?.label || category || '普通供应商';
}

function nextSupplierCode(existingCodes, prefix) {
  let seq = 1;
  let candidate = `${prefix}-${String(seq).padStart(3, '0')}`;
  while (existingCodes.has(candidate)) {
    seq += 1;
    candidate = `${prefix}-${String(seq).padStart(3, '0')}`;
  }
  return candidate;
}

function buildSetupSummary(rows) {
  const categoryCounters = Object.fromEntries(SUPPLIER_CATEGORIES.map((item) => [item.value, 0]));
  let active = 0;
  const covered = new Set();
  for (const row of rows) {
    if (row.is_active ?? true) active += 1;
    const categories = safeJson(row.business_categories, row.supplier_category ? [row.supplier_category] : []);
    if (row.supplier_category) categoryCounters[row.supplier_category] = (categoryCounters[row.supplier_category] || 0) + 1;
    for (const category of categories) covered.add(category);
  }
  const missingRequired = REQUIRED_SUPPLIER_CATEGORIES.filter((category) => !covered.has(category));
  const bootstrapTemplates = BOOTSTRAP_TEMPLATES.map((item) => ({
    ...item,
    label: categoryLabel(item.category),
    exists: covered.has(item.category),
  }));
  return {
    total: rows.length,
    active,
    by_category: categoryCounters,
    required_total: REQUIRED_SUPPLIER_CATEGORIES.length,
    required_covered: REQUIRED_SUPPLIER_CATEGORIES.length - missingRequired.length,
    missing_required: missingRequired.map((value) => ({ value, label: categoryLabel(value) })),
    bootstrap_templates: bootstrapTemplates,
  };
}

function register(app, db) {
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

  app.get('/api/suppliers/categories', wrap((_req, res) => {
    res.json(SUPPLIER_CATEGORIES);
  }))

  app.get('/api/suppliers', wrap((req, res) => {
    const { is_active, supplier_category, category } = req.query
    const categoryFilter = supplier_category || category
    let sql = 'SELECT * FROM suppliers WHERE 1=1'
    const params = []
    if (is_active !== undefined) { sql += ' AND is_active = ?'; params.push(parseInt(is_active, 10)) }
    if (categoryFilter) {
      sql += " AND (supplier_category = ? OR business_categories LIKE ?)"
      params.push(categoryFilter, `%\"${categoryFilter}\"%`)
    }
    sql += ' ORDER BY supplier_category, supplier_code'
    res.json(all(sql, params).map(decorate))
  }))

  app.get('/api/suppliers/setup-summary', wrap((_req, res) => {
    const rows = all('SELECT * FROM suppliers ORDER BY supplier_code').map(decorate)
    res.json(buildSetupSummary(rows))
  }))

  app.post('/api/suppliers/bootstrap-defaults', wrap((req, res) => {
    const requested = safeJson(req.body?.categories, REQUIRED_SUPPLIER_CATEGORIES)
    const rows = all('SELECT * FROM suppliers')
    const covered = new Set()
    const existingCodes = new Set(rows.map((row) => row.supplier_code).filter(Boolean))
    for (const row of rows) {
      for (const category of safeJson(row.business_categories, row.supplier_category ? [row.supplier_category] : [])) {
        covered.add(category)
      }
    }
    const created = []
    for (const template of BOOTSTRAP_TEMPLATES) {
      if (!requested.includes(template.category)) continue
      if (covered.has(template.category)) continue
      const supplier_code = nextSupplierCode(existingCodes, template.code_prefix)
      existingCodes.add(supplier_code)
      covered.add(template.category)
      const categories = [template.category]
      const result = run(`INSERT INTO suppliers (
        supplier_code, supplier_name, contact_person, payment_terms, rating, notes,
        supplier_category, business_categories, is_key_supplier, is_outsource_supplier, is_standard_supplier, category_notes, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, [
        supplier_code,
        template.supplier_name,
        template.contact_person,
        '月结30天',
        template.rating,
        `${categoryLabel(template.category)}首日模板`,
        template.category,
        JSON.stringify(categories),
        template.category === 'key_component' ? 1 : 0,
        template.category === 'outsourcing' ? 1 : 0,
        template.category === 'standard_part' ? 1 : 0,
        template.category_notes,
      ])
      created.push({ id: result.lastInsertRowid, supplier_code, supplier_name: template.supplier_name, supplier_category: template.category })
    }
    const summary = buildSetupSummary(all('SELECT * FROM suppliers ORDER BY supplier_code').map(decorate))
    res.json({ created, summary })
  }))

  app.get('/api/suppliers/:id', wrap((req, res) => {
    const r = get('SELECT * FROM suppliers WHERE id = ?', req.params.id)
    if (!r) throw ApiError.notFound('supplier not found')
    const stats = get("SELECT COUNT(*) AS po_count, COALESCE(SUM(total_amount), 0) AS total_amount FROM purchase_orders WHERE supplier_id = ?", req.params.id)
    res.json(Object.assign({}, decorate(r), stats))
  }))

  app.post('/api/suppliers', wrap((req, res) => {
    const {
      supplier_code, supplier_name, contact_person, phone, email, address, payment_terms, rating, notes,
      supplier_category = 'general', business_categories, category_notes, is_active = 1,
    } = req.body
    if (!supplier_code || !supplier_name) throw ApiError.validation('supplier_code / supplier_name 必填')
    if (!SUPPLIER_CATEGORIES.some((item) => item.value === supplier_category)) throw ApiError.validation('供应商分类不合法')
    const categories = safeJson(business_categories, [supplier_category])
    const dup = get('SELECT id FROM suppliers WHERE supplier_code = ?', supplier_code)
    if (dup) throw ApiError.validation('supplier_code 已存在: ' + supplier_code)
    const r = run(`INSERT INTO suppliers (
        supplier_code, supplier_name, contact_person, phone, email, address, payment_terms, rating, notes,
        supplier_category, business_categories, is_key_supplier, is_outsource_supplier, is_standard_supplier, category_notes, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        supplier_code, supplier_name, contact_person || null, phone || null, email || null, address || null,
        payment_terms || null, rating || 'B', notes || null, supplier_category, JSON.stringify(categories),
        categories.includes('key_component') ? 1 : 0,
        categories.includes('outsourcing') ? 1 : 0,
        categories.includes('standard_part') ? 1 : 0,
        category_notes || null,
        is_active ? 1 : 0,
      ])
    res.json({ id: r.lastInsertRowid })
  }))

  app.patch('/api/suppliers/:id', wrap((req, res) => {
    const existing = get('SELECT id FROM suppliers WHERE id = ?', req.params.id)
    if (!existing) throw ApiError.notFound('supplier not found')
    const body = { ...req.body }
    if (body.supplier_category && !SUPPLIER_CATEGORIES.some((item) => item.value === body.supplier_category)) throw ApiError.validation('供应商分类不合法')
    if (body.business_categories !== undefined) {
      const categories = safeJson(body.business_categories, body.supplier_category ? [body.supplier_category] : []);
      body.business_categories = JSON.stringify(categories);
      body.is_key_supplier = categories.includes('key_component') ? 1 : 0;
      body.is_outsource_supplier = categories.includes('outsourcing') ? 1 : 0;
      body.is_standard_supplier = categories.includes('standard_part') ? 1 : 0;
      if (!body.supplier_category && categories.length) body.supplier_category = categories[0];
    }
    const allowed = [
      'supplier_name', 'contact_person', 'phone', 'email', 'address', 'payment_terms', 'rating', 'is_active', 'notes',
      'supplier_category', 'business_categories', 'is_key_supplier', 'is_outsource_supplier', 'is_standard_supplier', 'category_notes'
    ]
    const sets = [], params = []
    for (const k of allowed) if (body[k] !== undefined) { sets.push(k + ' = ?'); params.push(body[k]) }
    if (!sets.length) throw ApiError.validation('无可更新字段')
    sets.push("updated_at = datetime('now')")
    params.push(req.params.id)
    const r = run('UPDATE suppliers SET ' + sets.join(', ') + ' WHERE id = ?', params)
    res.json({ changes: r.changes })
  }))

  app.delete('/api/suppliers/:id', wrap((req, res) => {
    const r = get('SELECT id, supplier_name FROM suppliers WHERE id = ?', req.params.id)
    if (!r) throw ApiError.notFound('supplier not found')
    const poCount = get('SELECT COUNT(*) AS c FROM purchase_orders WHERE supplier_id = ?', req.params.id).c
    if (poCount > 0) throw ApiError.validation('该供应商有 ' + poCount + ' 个关联采购订单, 无法删除')
    run('DELETE FROM suppliers WHERE id = ?', req.params.id)
    res.json({ ok: true })
  }))
}

module.exports = { register }
