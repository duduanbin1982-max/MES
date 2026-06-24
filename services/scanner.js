// services/scanner.js
// 批次 3 重构：从 server.js 抽出

// db.js 提供 db 实例；本文件用闭包包裹工具函数
const all = (db, sql, params = []) => db.prepare(sql).all(params);
const get = (db, sql, params = []) => db.prepare(sql).get(params);
const run = (db, sql, params = []) => db.prepare(sql).run(params);
const wrap = (handler) => (req, res) => {
  try { handler(req, res); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
};

function scanLookup(req, res, db) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code 必填' });

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

  res.status(404).json({ error: '未找到该码: ' + code });
}

function scanExecute(req, res, db) {
  const { code, action, operator_id, hours_worked, notes } = req.body;
  if (!code || !action) return res.status(400).json({ error: 'code/action 必填' });

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

  if (!target) return res.status(404).json({ error: '未找到该码: ' + code });

  const t = db.transaction(() => {
    if (targetType === 'work_order') {
      // 原有 work_order execute 逻辑
      const r = run(db, 
        "INSERT INTO work_order_operations (work_order_id, operator_id, action, hours_worked, notes) VALUES (?, ?, ?, ?, ?)",
        [target.id, operator_id || null, action, hours_worked || null, notes || null]
      );
      if (action === 'start') run(db, "UPDATE work_orders SET status = 'in_progress', actual_start = COALESCE(actual_start, datetime('now')) WHERE id = ?", target.id);
      else if (action === 'complete') run(db, "UPDATE work_orders SET status = 'completed', actual_end = datetime('now') WHERE id = ?", target.id);
      else if (action === 'pause') run(db, "UPDATE work_orders SET status = 'paused' WHERE id = ?", target.id);
      return r;
    } else {
      // process_node execute + 自动解锁 + 飞书通知
      const r = run(db, 
        "INSERT INTO process_executions (process_node_id, operator_id, action, hours_worked, notes) VALUES (?, ?, ?, ?, ?)",
        [target.id, operator_id || null, action, hours_worked || null, notes || null]
      );
      const inst = get(db, 'SELECT equipment_instance_id FROM process_nodes WHERE id = ?', target.id);
      if (action === 'start') {
        run(db, "UPDATE process_nodes SET status = 'in_progress', actual_start = COALESCE(actual_start, datetime('now')), updated_at = datetime('now') WHERE id = ?", target.id);
      } else if (action === 'complete' || action === 'qc') {
        run(db, "UPDATE process_nodes SET status = 'completed', actual_end = COALESCE(actual_end, datetime('now')), updated_at = datetime('now') WHERE id = ?", target.id);
        if (action === 'complete' || (action === 'qc' && req.body.result === 'pass')) {
          if (inst) autoUnlockSuccessors(target.id, inst.equipment_instance_id);
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

module.exports = { scanLookup, scanExecute };
