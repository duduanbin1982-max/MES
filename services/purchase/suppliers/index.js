// services/purchase/suppliers.js
// 供应商 CRUD + 分类治理

const { makeHelpers } = require('../_helpers')
const { wrap } = require('../../../middleware/asyncHandler');
const { ApiError } = require('../../../app/errors');

const createContext = require("./context");
const registerRoutes1 = require("./routes_1");
const registerRoutes2 = require("./routes_2");

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
  const ctx = createContext(app, db, { BOOTSTRAP_TEMPLATES, REQUIRED_SUPPLIER_CATEGORIES, SUPPLIER_CATEGORIES, buildSetupSummary, categoryLabel, nextSupplierCode, safeJson });
  registerRoutes1(app, db, ctx);
  registerRoutes2(app, db, ctx);
}

module.exports = { register }
