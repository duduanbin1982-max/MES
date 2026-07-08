// services/materialService.js
const { ApiError } = require("../app/errors");
// 物料管理 — 物料批次/关键件/单位路由 (brooks-debt R1: 库存/移动已拆分)
'use strict';

const { wrap } = require('../middleware/asyncHandler');
const { makeDbHelpers, queryLowStock } = require('./material/core');

function register(app, db) {
  const { all, get, run } = makeDbHelpers(db);

  // P3-1 权限守卫: 写端点限制角色, 读端点只要求登录
  const requireRole = (...allowed) => (req, res) => {
    if (!req.user) { throw ApiError.unauthorized(); return true; }
    if (!allowed.includes(req.user.role)) { throw ApiError.forbidden('权限不足, 需要角色: ' + allowed.join('/')); return true; }
    return false;
  };
  // 读端点: 只要登录 (any authenticated user)
  const requireLogin = (req, res) => {
    if (!req.user) { throw ApiError.unauthorized(); return true; }
    return false;
  };
  // P0-1 细粒度 permission 守卫 (高阶: 调用后 if (true) return 跳出)
  const requirePermission = (...permCodes) => (req, res) => {
    if (!req.user) { throw ApiError.unauthorized(); return true; }
    const userPerms = req.user.permissions || [];
    const ok = permCodes.some(code => userPerms.includes('*') || userPerms.includes(code) ||
      userPerms.some(p => p.endsWith(':*') && code.startsWith(p.slice(0, -1))));
    if (!ok) { throw ApiError.forbidden('权限不足, 需要: ' + permCodes.join(' / ')); return true; }
    return false;
  };


  // ============================================================
  // 物料批次
  // ============================================================
  app.get('/api/material_lots', wrap((req, res) => {
    const { material_id } = req.query;
    let sql = "SELECT ml.*, m.material_name FROM material_lots ml JOIN materials m ON ml.material_id = m.id";
    const params = [];
    if (material_id) { sql += ' WHERE ml.material_id = ?'; params.push(material_id); }
    sql += ' ORDER BY ml.received_date DESC';
    res.json(all(sql, params));
  }));

  // P3-4 单查 lot: 含 lot 详情 + 当前各库位库存 + 累计 movements 汇总
  app.get('/api/material_lots/:id', wrap((req, res) => {
    if (requireLogin(req, res)) return;
    const id = parseInt(req.params.id);
    if (!id) throw ApiError.validation('id 必填且必须为数字');
    const lot = get("SELECT ml.*, m.material_code, m.material_name, m.spec, m.unit AS material_unit FROM material_lots ml JOIN materials m ON ml.material_id = m.id WHERE ml.id = ?", id);
    if (!lot) throw ApiError.notFound('lot 不存在');
    const inventory = all("SELECT location, quantity, unit, status, last_updated FROM inventory WHERE material_lot_id = ? ORDER BY location", id);
    const totalQty = inventory.reduce((s, r) => s + (r.quantity || 0), 0);
    const movements = all("SELECT movement_type, SUM(quantity) AS qty, COUNT(*) AS cnt FROM material_movements WHERE material_lot_id = ? GROUP BY movement_type", id);
    const movementStats = {};
    for (const m of movements) movementStats[m.movement_type] = { qty: m.qty, cnt: m.cnt };
    res.json({ ...lot, inventory, inventory_total: totalQty, movement_stats: movementStats });
  }));


  // ============================================================
  // 库存
  // ============================================================
    // P0-#3 一键入库: 建 lot + 初始 inventory + 写 receive movement, 事务内
  //   后续 P1-#4 采购模块做好后, 收货可带 PO 单号 + 自动写 key_component_prices
  // P3-5 拆批: 从源 lot 拆出 quantity 到新 lot (新 lot_no 必带), 同步 inventory (源 -qty, 新 +qty)
  app.post('/api/material_lots/:id/split', wrap((req, res) => {
    if (requirePermission('material:write')(req, res)) return;
    const srcId = parseInt(req.params.id);
    if (!srcId) throw ApiError.validation('id 非法');
    const { quantity, new_lot_no, location, notes } = req.body;
    if (!quantity || !new_lot_no) throw ApiError.validation('quantity/new_lot_no 必填');
    const qty = Math.abs(Number(quantity));
    if (qty <= 0) throw ApiError.validation('quantity 必须 > 0');
    const dup = get('SELECT id FROM material_lots WHERE lot_no = ?', new_lot_no);
    if (dup) throw ApiError.validation('新 lot_no 已存在');
    const result = db.transaction(() => {
      const src = get('SELECT * FROM material_lots WHERE id = ?', srcId);
      if (!src) { const e = new Error('源 lot 不存在'); e.status = 404; throw e; }
      // 找源 lot 在 location 的可用库存
      const loc = location || '主仓库-A-01';
      const inv = get('SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ?', [srcId, loc]);
      if (!inv || inv.quantity < qty) { const e = new Error('源库位库存不足: 现有 ' + (inv ? inv.quantity : 0) + ', 要拆 ' + qty); e.status = 400; throw e; }
      // 1) 源 lot 库存 -qty
      run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [qty, inv.id]);
      // 2) 创建新 lot
      const r = run(
        "INSERT INTO material_lots (material_id, lot_no, supplier, heat_no, certificate_no, received_date, quantity, unit, quality_status, notes) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)",
        [src.material_id, new_lot_no, src.supplier, src.heat_no, src.certificate_no, qty, src.unit, src.quality_status, '由 ' + src.lot_no + ' 拆出 ' + qty + (notes ? '; ' + notes : '')]
      );
      const newId = r.lastInsertRowid;
      // 3) 新 lot 库存 +qty
      run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [newId, loc, qty, src.unit]);
      // 4) 源 lot 写 transfer movement (split 视为内部调拨)
      run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, notes) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
        [srcId, qty, src.unit, loc, loc, 'split to ' + new_lot_no]);
      return { source_lot_id: srcId, new_lot_id: newId, new_lot_no, quantity: qty, location: loc };
    })();
    res.json(result);
  }));

  // P3-6 合批: 把多个源 lot 合并到目标 lot, 库存累加, 写 movement
  app.post('/api/material_lots/:id/merge', wrap((req, res) => {
    if (requirePermission('material:write')(req, res)) return;
    const dstId = parseInt(req.params.id);
    if (!dstId) throw ApiError.validation('id 非法');
    const { source_lot_ids, location, notes } = req.body;
    if (!Array.isArray(source_lot_ids) || source_lot_ids.length === 0) throw ApiError.validation('source_lot_ids 数组必填');
    if (source_lot_ids.length > 50) throw ApiError.validation('源 lot 上限 50 个');
    if (source_lot_ids.includes(dstId)) throw ApiError.validation('不能合到自身');
    const result = db.transaction(() => {
      const dst = get('SELECT * FROM material_lots WHERE id = ?', dstId);
      if (!dst) { const e = new Error('目标 lot 不存在'); e.status = 404; throw e; }
      const loc = location || '主仓库-A-01';
      const merged = [];
      for (const sid of source_lot_ids) {
        const src = get('SELECT * FROM material_lots WHERE id = ?', sid);
        if (!src) { const e = new Error('源 lot ' + sid + ' 不存在'); e.status = 404; throw e; }
        if (src.material_id !== dst.material_id) { const e = new Error('源 lot ' + sid + ' 物料 ' + src.material_id + ' 与目标 ' + dst.material_id + ' 不同'); e.status = 400; throw e; }
        const inv = get('SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ?', [sid, loc]);
        if (!inv) { const e = new Error('源 lot ' + sid + ' 在 ' + loc + ' 无库存'); e.status = 400; throw e; }
        // 1) 源 lot 库存归零
        run("UPDATE inventory SET quantity = 0, last_updated = datetime('now') WHERE id = ?", [inv.id]);
        // 2) 目标 lot 库存 +qty
        const dstInv = get('SELECT id FROM inventory WHERE material_lot_id = ? AND location = ?', [dstId, loc]);
        if (dstInv) {
          run("UPDATE inventory SET quantity = quantity + ?, last_updated = datetime('now') WHERE id = ?", [inv.quantity, dstInv.id]);
        } else {
          run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [dstId, loc, inv.quantity, src.unit]);
        }
        // 3) 写 transfer movement
        run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, notes) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
          [sid, inv.quantity, src.unit, loc, loc, 'merged to lot ' + dst.lot_no + (notes ? '; ' + notes : '')]);
        merged.push({ source_lot_id: sid, source_lot_no: src.lot_no, quantity: inv.quantity });
      }
      return { target_lot_id: dstId, target_lot_no: dst.lot_no, location: loc, merged };
    })();
    res.json(result);
  }));

  app.post('/api/material_lots/receive', wrap((req, res) => {
    if (requirePermission('material:write')(req, res)) return;
    const { material_id, lot_no, supplier, heat_no, certificate_no, quantity, unit, location, notes } = req.body;
    if (!material_id || !lot_no || !quantity) throw ApiError.validation('material_id/lot_no/quantity 必填');

    const mat = get('SELECT id, unit FROM materials WHERE id = ?', material_id);
    if (!mat) throw ApiError.notFound('物料不存在');

    const dup = get('SELECT id FROM material_lots WHERE lot_no = ?', lot_no);
    if (dup) throw ApiError.validation('lot_no 已存在: ' + lot_no);

    const loc = location || '主仓库-A-01';
    const u = unit || mat.unit || 'pcs';

    const tx = db.transaction(() => {
      const r = run(
        "INSERT INTO material_lots (material_id, lot_no, supplier, heat_no, certificate_no, received_date, quantity, unit, quality_status, notes) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, 'pending', ?)",
        [material_id, lot_no, supplier || null, heat_no || null, certificate_no || null, quantity, u, notes || null]
      );
      const lotId = r.lastInsertRowid;
      run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [lotId, loc, quantity, u]);
      run(
        "INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, to_location, notes) VALUES (?, 'receive', ?, ?, ?, ?)",
        [lotId, quantity, u, loc, '一键入库: ' + (notes || '')]
      );
      return { id: lotId };
    });

    try {
      const result = tx();
      res.json(result);
    } catch (e) {
      const status = e.status || 500;
      throw e;
    }
  }));
app.get('/api/inventory', wrap((req, res) => res.json(all("SELECT i.*, ml.lot_no, m.material_name FROM inventory i JOIN material_lots ml ON i.material_lot_id = ml.id JOIN materials m ON ml.material_id = m.id ORDER BY m.material_code"))));

  // P2-#1 低库存预警 (聚合所有 lot 的 quantity，对比 materials.safety_stock)
  app.get('/api/inventory/alerts', wrap((req, res) => {
    const rows = queryLowStock(db, { includeSpec: true });
    res.json({ count: rows.length, items: rows });
  }));

  // P2-#1 批次追溯
  app.get('/api/inventory/lot_trace', wrap((req, res) => {
    const { lot_id } = req.query;
    if (!lot_id) throw ApiError.validation('lot_id 必填');
    const lot = get('SELECT ml.*, m.material_code, m.material_name FROM material_lots ml JOIN materials m ON ml.material_id = m.id WHERE ml.id = ?', lot_id);
    if (!lot) throw ApiError.notFound('lot 不存在');
    const movements = all('SELECT * FROM material_movements WHERE material_lot_id = ? ORDER BY created_at', lot_id);
    const inventory = all('SELECT * FROM inventory WHERE material_lot_id = ?', lot_id);
    res.json({ lot, movements, inventory });
  }));

  // ============================================================
  // 物料 / 关键外购件
  // ============================================================
  app.get('/api/materials', wrap((req, res) => {
    const { is_key_component, is_self_made } = req.query;
    let sql = 'SELECT * FROM materials WHERE 1=1';
    if (is_key_component) sql += ' AND is_key_component = 1';
    if (is_self_made) sql += ' AND is_self_made = 1';
    sql += ' ORDER BY material_code';
    res.json(all(sql));
  }));


  // ============================================================
  // 物料主数据导入 / 编码规则校验 / 一物一码查重
  // ============================================================
  const CODE_PREFIX_BY_TYPE = {
    machining: 'JJ',
    sheet_metal: 'BJ',
    fastener: 'BZ',
    pneumatic: 'QD',
    electrical: 'DQ',
    purchased: 'WG',
    raw: 'YL',
    auxiliary: 'FL',
  };

  function normalizeHeader(value) {
    const key = String(value || '').trim().toLowerCase();
    const map = {
      '物料编码': 'material_code', '编码': 'material_code', 'code': 'material_code', 'material_code': 'material_code',
      '物料名称': 'material_name', '名称': 'material_name', 'name': 'material_name', 'material_name': 'material_name',
      '物料类型': 'material_type', '类型': 'material_type', 'type': 'material_type', 'material_type': 'material_type',
      '规格': 'spec', '型号': 'spec', 'spec': 'spec',
      '单位': 'unit', 'unit': 'unit',
      '关键件': 'is_key_component', 'is_key_component': 'is_key_component',
      '自制': 'is_self_made', 'is_self_made': 'is_self_made',
      '默认供应商': 'default_supplier', 'supplier': 'default_supplier', 'default_supplier': 'default_supplier',
      '安全库存': 'safety_stock', 'safety_stock': 'safety_stock',
      '再订货点': 'reorder_point', 'reorder_point': 'reorder_point',
      '预估单价': 'estimated_unit_price', 'estimated_unit_price': 'estimated_unit_price',
      '实际单价': 'actual_unit_price', 'actual_unit_price': 'actual_unit_price',
      '备注': 'notes', 'notes': 'notes',
    };
    return map[key] || key;
  }

  function parseBool(value) {
    if (value === true || value === 1) return 1;
    const text = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', '是', '关键', '自制'].includes(text) ? 1 : 0;
  }

  function parseNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }

  function splitCsvLine(line) {
    const cells = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; continue; }
      if (ch === '"') { quoted = !quoted; continue; }
      if ((ch === ',' || ch === '\t') && !quoted) { cells.push(current.trim()); current = ''; continue; }
      cells.push ? current += ch : null;
    }
    cells.push(current.trim());
    return cells;
  }

  function parseMaterialRows(payload) {
    if (Array.isArray(payload.rows)) return payload.rows;
    if (Array.isArray(payload)) return payload;
    const text = String(payload.text || payload.csv || '').trim();
    if (!text) return [];
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = splitCsvLine(lines[0]).map(normalizeHeader);
    return lines.slice(1).map((line) => {
      const cells = splitCsvLine(line);
      const row = {};
      headers.forEach((header, index) => { row[header] = cells[index] ?? ''; });
      return row;
    });
  }

  function normalizeMaterial(row) {
    return {
      material_code: String(row.material_code || '').trim(),
      material_name: String(row.material_name || '').trim(),
      material_type: String(row.material_type || 'purchased').trim(),
      spec: String(row.spec || '').trim() || null,
      unit: String(row.unit || '件').trim(),
      is_key_component: parseBool(row.is_key_component),
      is_self_made: parseBool(row.is_self_made),
      default_supplier: String(row.default_supplier || '').trim() || null,
      safety_stock: parseNumber(row.safety_stock),
      reorder_point: parseNumber(row.reorder_point),
      estimated_unit_price: parseNumber(row.estimated_unit_price),
      actual_unit_price: parseNumber(row.actual_unit_price),
      notes: String(row.notes || '').trim() || null,
    };
  }

  function validateMaterial(material, seenCodes, rowIndex) {
    const errors = [];
    const warnings = [];
    if (!material.material_code) errors.push('物料编码必填');
    if (!material.material_name) errors.push('物料名称必填');
    if (!material.unit) errors.push('单位必填');
    if (!/^[A-Z]{2,4}-[A-Z0-9][A-Z0-9-]{1,40}$/i.test(material.material_code)) {
      errors.push('物料编码格式建议为 前缀-流水号，如 JJ-0001 / BZ-M8-020');
    }
    const expectedPrefix = CODE_PREFIX_BY_TYPE[material.material_type];
    if (expectedPrefix && !material.material_code.toUpperCase().startsWith(expectedPrefix + '-')) {
      warnings.push(`物料类型 ${material.material_type} 建议编码前缀 ${expectedPrefix}-`);
    }
    if (seenCodes.has(material.material_code)) errors.push('导入文件内物料编码重复');
    seenCodes.add(material.material_code);
    const existing = get('SELECT id, material_name, spec, unit FROM materials WHERE material_code = ?', material.material_code);
    if (existing) errors.push(`系统中已存在相同物料编码: ${existing.material_name}`);
    const sameIdentity = all(`
      SELECT id, material_code
      FROM materials
      WHERE material_name = ? AND COALESCE(spec, '') = COALESCE(?, '') AND unit = ? AND material_type = ?
      LIMIT 5
    `, [material.material_name, material.spec || '', material.unit, material.material_type]);
    if (sameIdentity.length) {
      warnings.push('疑似一物多码: ' + sameIdentity.map(item => item.material_code).join(', '));
    }
    return { row: rowIndex, material, errors, warnings, valid: errors.length === 0 };
  }

  app.get('/api/materials/import/template', wrap((req, res) => {
    res.type('text/csv; charset=utf-8');
    res.send([
      'material_code,material_name,material_type,spec,unit,is_key_component,is_self_made,default_supplier,safety_stock,reorder_point,estimated_unit_price,actual_unit_price,notes',
      'JJ-0001,安装底板,machining,Q235B,件,0,1,机加工供应商A,2,1,120,118,示例',
      'BZ-M8-020,内六角圆柱头螺钉,fastener,M8×20,件,0,0,东明,200,100,0.35,0.32,GB/T 70.1',
    ].join('\n'));
  }));

  app.post('/api/materials/import/validate', wrap((req, res) => {
    const rows = parseMaterialRows(req.body || {});
    const seenCodes = new Set();
    const results = rows.map((row, index) => validateMaterial(normalizeMaterial(row), seenCodes, index + 2));
    const valid = results.filter(item => item.valid).length;
    const invalid = results.length - valid;
    const warnings = results.reduce((sum, item) => sum + item.warnings.length, 0);
    res.json({ total: results.length, valid, invalid, warnings, items: results });
  }));

  app.post('/api/materials/import/commit', wrap((req, res) => {
    if (requirePermission('material:write')(req, res)) return;
    const rows = parseMaterialRows(req.body || {});
    const seenCodes = new Set();
    const results = rows.map((row, index) => validateMaterial(normalizeMaterial(row), seenCodes, index + 2));
    const invalid = results.filter(item => !item.valid);
    if (invalid.length) throw ApiError.validation('存在校验错误，禁止导入', invalid.slice(0, 20));
    const tx = db.transaction(() => {
      const created = [];
      for (const item of results) {
        const m = item.material;
        const r = run(`
          INSERT INTO materials (
            material_code, material_name, material_type, spec, unit, is_key_component, is_self_made,
            default_supplier, notes, safety_stock, reorder_point, estimated_unit_price, actual_unit_price
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          m.material_code, m.material_name, m.material_type, m.spec, m.unit, m.is_key_component, m.is_self_made,
          m.default_supplier, m.notes, m.safety_stock, m.reorder_point, m.estimated_unit_price, m.actual_unit_price,
        ]);
        created.push({ id: r.lastInsertRowid, material_code: m.material_code });
      }
      return created;
    });
    const created = tx();
    res.json({ created: created.length, items: created });
  }));

  app.get('/api/material_duplicates', wrap((req, res) => {
    const codeDuplicates = all(`
      SELECT material_code, COUNT(*) AS count
      FROM materials
      GROUP BY material_code
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `);
    const identityDuplicates = all(`
      SELECT material_name, COALESCE(spec, '') AS spec, unit, material_type, COUNT(*) AS count,
             GROUP_CONCAT(material_code) AS material_codes
      FROM materials
      GROUP BY material_name, COALESCE(spec, ''), unit, material_type
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `);
    res.json({ code_duplicates: codeDuplicates, identity_duplicates: identityDuplicates });
  }));

  app.get('/api/key_components', wrap((req, res) => res.json(all("SELECT kc.*, m.material_name FROM key_components kc JOIN materials m ON kc.material_id = m.id ORDER BY kc.lead_time_weeks DESC"))));
  app.get('/api/key_components/long_leadtime', wrap((req, res) => res.json(all("SELECT kc.*, m.material_name FROM key_components kc JOIN materials m ON kc.material_id = m.id WHERE kc.lead_time_weeks >= 12 ORDER BY kc.lead_time_weeks DESC"))));

  // ============================================================
  // 物料移动 + 库存账面同步 (P0-#2 修)
  // ============================================================
}

module.exports = { register };
