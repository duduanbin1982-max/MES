const { ApiError } = require('../app/errors');
const { wrap } = require('../middleware/asyncHandler');
const { feishuNotify } = require('./feishuNotify');
const { autoUnlockSuccessors } = require('./process/node/_helpers');
// services/scanner.js
// 批次 3 重构：从 server.js 抽出

// db.js 提供 db 实例；本文件用闭包包裹工具函数
const all = (db, sql, params = []) => db.prepare(sql).all(params);
const get = (db, sql, params = []) => db.prepare(sql).get(params);
const run = (db, sql, params = []) => db.prepare(sql).run(params);

// Part B: add quantity columns to process_executions (idempotent)
function ensureQuantityColumns(db) {
  const addCol = (table, colDef) => {
    try { db.prepare("ALTER TABLE " + table + " ADD COLUMN " + colDef).run(); }
    catch (e) { /* already exists */ }
  };
  addCol("process_executions", "quantity_completed INTEGER DEFAULT 0");
  addCol("process_executions", "defect_quantity INTEGER DEFAULT 0");
}


function register(_app, db) {
  ensureQuantityColumns(db);
}

function scanLookup(req, res, db) {
  const { code } = req.query;
  if (!code) throw ApiError.validation('code 必填')

  // 尝试作为工单号
  const wo = get(db, "SELECT wo.*, ei.instance_code, es.name_zh as subsystem_name FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id LEFT JOIN equipment_subsystems es ON wo.subsystem_id = es.id WHERE wo.wo_code = ?", code);
  if (wo) {
    return res.json({ type: 'work_order', data: wo });
  }

  // 尝试作为 process_node (数字 ID 或 PN-xxxx)
  let pnId = null;
  if (/^PN-?(\d+)/i.test(code)) {
    pnId = parseInt(code.replace(/^PN-?/i, ''));
  } else if (/^\d+$/.test(code)) {
    pnId = parseInt(code);
  }
  if (pnId) {
    const pn = get(db, "SELECT pn.*, ei.instance_code, m.material_name FROM process_nodes pn JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id LEFT JOIN instance_bom ib ON pn.bom_node_id = ib.id LEFT JOIN materials m ON ib.material_id = m.id WHERE pn.id = ?", pnId);
    if (pn) return res.json({ type: 'process_node', data: pn });
  }

  throw ApiError.notFound('未找到该码: ' + code);
}

function scanExecute(req, res, db) {
  const { code, action, operator_id, hours_worked, notes, quantity_completed, defect_quantity } = req.body;
  if (!code || !action) throw ApiError.validation('code/action 必填')

  // 先识别码
  let target = null;
  let targetType = null;
  const wo = get(db, "SELECT * FROM work_orders WHERE wo_code = ?", code);
  if (wo) { target = wo; targetType = 'work_order'; }
  else {
    let pnId = null;
    if (/^PN-?(\d+)/i.test(code)) pnId = parseInt(code.replace(/^PN-?/i, ''));
    else if (/^\d+$/.test(code)) pnId = parseInt(code);
    if (pnId) {
      const pn = get(db, 'SELECT * FROM process_nodes WHERE id = ?', pnId);
      if (pn) { target = pn; targetType = 'process_node'; }
    }
  }

  if (!target) throw ApiError.notFound('未找到该码: ' + code);

  const t = db.transaction(() => {
    if (targetType === 'work_order') {
      // 原有 work_order execute 逻辑 + quantity reporting
      const r = run(db, 
        "INSERT INTO work_order_operations (work_order_id, operator_id, action, hours_worked, quantity_completed, defect_quantity, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [target.id, operator_id || null, action, hours_worked || null, quantity_completed || 0, defect_quantity || 0, notes || null]
      );
      if (action === 'start') run(db, "UPDATE work_orders SET status = 'in_progress', actual_start = COALESCE(actual_start, datetime('now')) WHERE id = ?", target.id);
      else if (action === 'complete') {
        const qtyDone = (target.quantity_completed || 0) + (quantity_completed || 0);
        if (qtyDone >= (target.quantity_planned || 1)) {
          run(db, "UPDATE work_orders SET status = 'completed', actual_end = datetime('now'), quantity_completed = ? WHERE id = ?", [qtyDone, target.id]);
        } else {
          run(db, "UPDATE work_orders SET quantity_completed = ? WHERE id = ?", [qtyDone, target.id]);
        }
      }
      else if (action === 'pause') run(db, "UPDATE work_orders SET status = 'paused' WHERE id = ?", target.id);
      return r;
    } else {
      // process_node execute + quantity reporting + 自动解锁 + 飞书通知
      const r = run(db, 
        "INSERT INTO process_executions (process_node_id, operator_id, action, hours_worked, quantity_completed, defect_quantity, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [target.id, operator_id || null, action, hours_worked || null, quantity_completed || 0, defect_quantity || 0, notes || null]
      );
      const inst = get(db, 'SELECT equipment_instance_id FROM process_nodes WHERE id = ?', target.id);
      if (action === 'start') {
        run(db, "UPDATE process_nodes SET status = 'in_progress', actual_start = COALESCE(actual_start, datetime('now')), updated_at = datetime('now') WHERE id = ?", target.id);
      } else if (action === 'complete' || action === 'qc') {
        run(db, "UPDATE process_nodes SET status = 'completed', actual_end = COALESCE(actual_end, datetime('now')), updated_at = datetime('now') WHERE id = ?", target.id);
        if (action === 'complete' || (action === 'qc' && req.body.result === 'pass')) {
          if (inst) autoUnlockSuccessors(db, target.id, inst.equipment_instance_id);
        }
        // Update work_order quantity if applicable
        if (target.work_order_id && quantity_completed) {
          const wo = get(db, 'SELECT quantity_completed, quantity_planned FROM work_orders WHERE id = ?', target.work_order_id);
          if (wo) {
            const qtyDone = (wo.quantity_completed || 0) + (quantity_completed || 0);
            run(db, 'UPDATE work_orders SET quantity_completed = ? WHERE id = ?', [qtyDone, target.work_order_id]);
          }
        }
        // 飞书通知: 关键节点完成
        if (inst) {
          const ei = get(db, 'SELECT instance_code, customer_name FROM equipment_instances WHERE id = ?', inst.equipment_instance_id);
          if (ei) feishuNotify('工序完成', ei.instance_code + ' · ' + target.operation_name + ' (PDA扫码完成)', 'foreman');
        }
      } else if (action === 'block') {
        run(db, "UPDATE process_nodes SET status = 'blocked', updated_at = datetime('now') WHERE id = ?", target.id);
        if (inst) {
          const ei = get(db, 'SELECT instance_code FROM equipment_instances WHERE id = ?', inst.equipment_instance_id);
          if (ei) feishuNotify('工艺节点卡住', ei.instance_code + ' · ' + target.operation_name + ' 已标记 blocked', 'foreman');
        }
      }
      return r;
    }
  });
  const r = t();
  res.json({ id: r.lastInsertRowid, target_type: targetType, target_id: target.id, message: '执行已记录' });
}

module.exports = { register, ensureQuantityColumns, scanLookup, scanExecute };
