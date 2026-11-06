"use strict";
// services/material/inventory.js 的路由组 6
// 2026-11-07 审计修复: 换算因子/单位校验, 重复 409, 删除 404 + 引用保护, 审计

module.exports = function registerRoutes6(app, db, ctx) {
const { wrap } = require('../../../middleware/asyncHandler');
const { ApiError } = require("../../../app/errors");
const audit = require('../../../app/audit');
const { get, requirePermission, run } = ctx;

  const UNIT_MAX_LEN = 32;
  const FACTOR_MAX = 1e9;

  const normalizeUnit = (value, field) => {
    const text = String(value == null ? '' : value).trim();
    if (!text) throw ApiError.validation(field + ' 不能为空');
    if (text.length > UNIT_MAX_LEN) throw ApiError.validation(field + ' 过长(<=32 字符)');
    return text;
  };

  // 原实现 `if (!factor)` 只挡住 0/空串, 负数和 'abc' 会直接写库
  const parseFactor = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) throw ApiError.validation('factor 必须是数字');
    if (n <= 0) throw ApiError.validation('factor 必须 > 0');
    if (n > FACTOR_MAX) throw ApiError.validation('factor 超出上限 ' + FACTOR_MAX);
    return Math.round(n * 1e6) / 1e6;
  };

  app.post('/api/material_units', wrap((req, res) => {
    if (requirePermission('material:write')(req, res)) return;
    const body = req.body || {};
    const materialId = Number(body.material_id);
    if (!Number.isInteger(materialId) || materialId <= 0) throw ApiError.validation('material_id 必须是正整数');
    const fromUnit = normalizeUnit(body.from_unit, 'from_unit');
    const toUnit = normalizeUnit(body.to_unit, 'to_unit');
    const factor = parseFactor(body.factor);
    if (fromUnit === toUnit) throw ApiError.validation('from_unit 和 to_unit 不能相同');
    const mat = get('SELECT id, unit FROM materials WHERE id = ?', materialId);
    if (!mat) throw ApiError.notFound('物料不存在');
    const duplicate = get('SELECT id, factor FROM material_units WHERE material_id = ? AND from_unit = ? AND to_unit = ?', [materialId, fromUnit, toUnit]);
    if (duplicate) throw ApiError.conflict('该换算规则已存在: 1 ' + fromUnit + ' = ' + duplicate.factor + ' ' + toUnit);
    const notes = body.notes == null ? null : String(body.notes).trim().slice(0, 200) || null;
    const created = run('INSERT INTO material_units (material_id, from_unit, to_unit, factor, notes) VALUES (?, ?, ?, ?, ?)', [materialId, fromUnit, toUnit, factor, notes]);
    // 原实现 db.lastInsertRowid 是 undefined (better-sqlite3 没有该属性)
    const id = Number(created.lastInsertRowid);
    audit.record(db, req, {
      action: 'material_unit.create',
      resource_type: 'material_unit',
      resource_id: id,
      after: { material_id: materialId, from_unit: fromUnit, to_unit: toUnit, factor },
      diff_summary: '新增换算 1 ' + fromUnit + ' = ' + factor + ' ' + toUnit,
    });
    res.json({ ok: true, id, message: '已添加换算 ' + fromUnit + ' -> ' + toUnit + ' (x' + factor + ')' });
  }));

  app.delete('/api/material_units/:id', wrap((req, res) => {
    if (requirePermission('material:write')(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw ApiError.validation('id 必须是正整数');
    const rule = get('SELECT * FROM material_units WHERE id = ?', id);
    if (!rule) throw ApiError.notFound('换算规则不存在');
    // 基础单位保护: 该单位已被实际批次/库存使用, 删掉换算后这些数量无法归一到基准单位
    const lotRefs = get('SELECT COUNT(*) AS c FROM material_lots WHERE material_id = ? AND unit IN (?, ?)', [rule.material_id, rule.from_unit, rule.to_unit]).c;
    const invRefs = get('SELECT COUNT(*) AS c FROM inventory i JOIN material_lots ml ON ml.id = i.material_lot_id WHERE ml.material_id = ? AND i.unit IN (?, ?)', [rule.material_id, rule.from_unit, rule.to_unit]).c;
    const refs = Number(lotRefs || 0) + Number(invRefs || 0);
    if (refs > 0) {
      throw ApiError.conflict('该换算规则的单位已被 ' + refs + ' 条批次/库存记录使用, 删除会导致单位无法归一; 请先清理对应库存');
    }
    const deleted = run('DELETE FROM material_units WHERE id = ?', id);
    audit.record(db, req, {
      action: 'material_unit.delete',
      resource_type: 'material_unit',
      resource_id: id,
      before: rule,
      diff_summary: '删除换算 ' + rule.from_unit + ' -> ' + rule.to_unit,
    });
    res.json({ ok: true, id, changes: deleted.changes });
  }));
};
