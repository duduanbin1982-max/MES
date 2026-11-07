"use strict";
// services/process/node/nodeActions.js
// 工艺节点业务动作 (5 个端点)
//   POST /api/process_nodes/:id/execute    执行工序 (写实际工时/状态)
//   POST /api/equipment_instances/:id/auto_unlock  批量解锁
//   PUT  /api/process_nodes/:id/move       调整顺序
//   PUT  /api/process_nodes/:id/assign     分配工人
//   GET  /api/process_nodes/:id/efficiency 效率统计
// Author: 三狗子 | Date: 2026-06-24
// 2026-11-07（工艺树审计）：execute 补 action/hours/result/operator 校验与审计；
//   move 复用父节点同实例/环校验；assign 补审计。

const { all, get, run, wrap, autoUnlockSuccessors } = require("./_helpers");
const { validateAssignment } = require("../../processMasterService");
const { ApiError } = require("../../../app/errors");
const audit = require("../../../app/audit");
const { resolveParentId } = require("./nodeCrud");
const { emit, Events } = require("../../../app/ws/EventBus");
const { assertStartAllowed, assertCompleteAllowed, seedItp, recordNodeEvent } = require("../../processRoute/execution");

const EXECUTE_ACTIONS = new Set(["start", "pause", "resume", "complete", "qc", "block", "note", "rework", "report"]);
const QC_RESULTS = new Set(["pass", "fail", "conditional"]);

function register(app, db) {
  app.post('/api/process_nodes/:id/execute', wrap((req, res) => {
    const body = req.body || {};
    const node = get(db, 'SELECT * FROM process_nodes WHERE id = ?', [req.params.id]);
    if (!node) throw ApiError.notFound("工艺节点不存在");
    const action = String(body.action || "").trim();
    if (!EXECUTE_ACTIONS.has(action)) throw ApiError.validation(`action 必须是 ${[...EXECUTE_ACTIONS].join(" / ")}`);
    const hours = body.hours_worked === undefined || body.hours_worked === null || body.hours_worked === ""
      ? 0
      : Number(body.hours_worked);
    if (!Number.isFinite(hours) || hours < 0 || hours > 100000) {
      throw ApiError.validation("hours_worked 必须是 0~100000 之间的数字");
    }
    const resultValue = body.result === undefined || body.result === null || body.result === ""
      ? null
      : String(body.result).trim();
    if (resultValue && !QC_RESULTS.has(resultValue)) {
      throw ApiError.validation(`result 必须是 ${[...QC_RESULTS].join(" / ")}`);
    }
    const operatorId = body.operator_id === undefined || body.operator_id === null || body.operator_id === ""
      ? null
      : Number(body.operator_id);
    if (operatorId !== null && (!Number.isInteger(operatorId) || operatorId <= 0)) {
      throw ApiError.validation("operator_id 非法");
    }
    if (operatorId !== null) {
      try {
        if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(operatorId)) throw ApiError.validation("操作人不存在");
      } catch (error) {
        if (error instanceof ApiError) throw error;
      }
    }
    const fromStatus = node.status;
    if (action === "start") {
      if (!["pending", "ready", "blocked"].includes(node.status)) throw ApiError.validation(`当前状态 ${node.status} 不允许开工`);
      seedItp(db, node);
      assertStartAllowed(db, node);
    } else if (action === "resume") {
      if (!["paused", "blocked"].includes(node.status)) throw ApiError.validation(`当前状态 ${node.status} 不允许恢复`);
      assertStartAllowed(db, node);
    } else if (action === "complete" || action === "qc") {
      if (node.status !== "in_progress") throw ApiError.validation(`当前状态 ${node.status} 不允许完工/质检`);
      assertCompleteAllowed(db, node);
    } else if (action === "pause") {
      if (node.status !== "in_progress") throw ApiError.validation(`当前状态 ${node.status} 不允许暂停`);
    }
    const t = db.transaction(() => {
      const r = run(db,
        "INSERT INTO process_executions (process_node_id, operator_id, action, hours_worked, result, notes, photos) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [req.params.id, operatorId, action, hours, resultValue, body.notes || null,
          body.photos ? JSON.stringify(body.photos) : null]
      );
      let toStatus = fromStatus;
      if (action === 'start' || action === 'resume') {
        toStatus = 'in_progress';
        run(db, "UPDATE process_nodes SET status = 'in_progress', actual_start = COALESCE(actual_start, datetime('now')), updated_at = datetime('now') WHERE id = ?", [req.params.id]);
      } else if (action === 'complete' || action === 'qc') {
        if (resultValue === 'fail') {
          toStatus = 'blocked';
          run(db, "UPDATE process_nodes SET status = 'blocked', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
        } else {
          toStatus = 'completed';
          run(db, "UPDATE process_nodes SET status = 'completed', actual_end = COALESCE(actual_end, datetime('now')), updated_at = datetime('now') WHERE id = ?", [req.params.id]);
          autoUnlockSuccessors(db, req.params.id, node.equipment_instance_id);
        }
      } else if (action === 'pause') {
        toStatus = 'paused';
        run(db, "UPDATE process_nodes SET status = 'paused', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
      } else if (action === 'block') {
        toStatus = 'blocked';
        run(db, "UPDATE process_nodes SET status = 'blocked', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
      } else if (action === 'rework') {
        toStatus = 'ready';
        run(db, "UPDATE process_nodes SET status = 'ready', actual_end = NULL, updated_at = datetime('now') WHERE id = ?", [req.params.id]);
        try { db.prepare("UPDATE process_itp_points SET status = 'pending', checked_by = NULL, checked_at = NULL WHERE process_node_id = ?").run(req.params.id); } catch (_error) { /* ignore */ }
      }
      recordNodeEvent(db, node, action, {
        fromStatus, toStatus, operatorId, hours,
        quantity: body.quantity, reason: body.reason || body.notes || null,
        meta: { result: resultValue, photos: body.photos || null },
      });
      return { r, toStatus };
    });
    const transactionResult = t();
    const r = transactionResult.r;
    audit.record(db, req, {
      action: "process_node.execute",
      resource_type: "process_execution",
      resource_id: r.lastInsertRowid,
      before: { status: fromStatus },
      after: { process_node_id: node.id, action, hours_worked: hours, result: resultValue, operator_id: operatorId, status: transactionResult.toStatus },
      diff_summary: `工序节点 ${node.id} 执行 ${action}（${fromStatus} → ${transactionResult.toStatus}）`,
    });
    emit(Events.BOM_UPDATED, { node_id: node.id, node_name: node.operation_name, equipment_instance_id: node.equipment_instance_id, action: `execute_${action}` });
    res.json({ id: r.lastInsertRowid, message: '执行已记录' });
  }));


  app.post('/api/equipment_instances/:id/auto_unlock', wrap((req, res) => {
    const allNodes = all(db, 'SELECT id, status FROM process_nodes WHERE equipment_instance_id = ?', req.params.id);
    let unlocked = 0;
    for (const n of allNodes) {
      if (n.status !== 'pending') continue;
      const hasPred = get(db, 'SELECT 1 as x FROM process_dependencies WHERE successor_id = ? LIMIT 1', n.id);
      if (!hasPred) {
        run(db, "UPDATE process_nodes SET status = 'ready', updated_at = datetime('now') WHERE id = ?", n.id);
        unlocked++;
      }
    }
    if (unlocked > 0) {
      audit.record(db, req, {
        action: "process_node.auto_unlock",
        resource_type: "equipment_instance",
        resource_id: req.params.id,
        after: { unlocked },
        diff_summary: `自动解锁 ${unlocked} 个根工序节点`,
      });
    }
    res.json({ unlocked: unlocked, message: '已解锁 ' + unlocked + ' 个根节点' });
  }));

  // 依赖管理

  app.put('/api/process_nodes/:id/move', wrap((req, res) => {
    const body = req.body || {};
    const before = get(db, 'SELECT * FROM process_nodes WHERE id = ?', [req.params.id]);
    if (!before) throw ApiError.notFound("工艺节点不存在");
    const parentId = resolveParentId(db, body.parent_id, { node: before });
    const r = run(db, "UPDATE process_nodes SET parent_id = ?, updated_at = datetime('now') WHERE id = ?", [parentId, before.id]);
    audit.record(db, req, {
      action: "process_node.move",
      resource_type: "process_node",
      resource_id: before.id,
      before: { parent_id: before.parent_id },
      after: { parent_id: parentId },
      diff_summary: `工序节点 ${before.id} 移动父节点 ${before.parent_id} -> ${parentId}`,
    });
    res.json({ changes: r.changes });
  }));


  app.put('/api/process_nodes/:id/assign', wrap((req, res) => {
    const { assigned_to, required_workstation_id, force } = req.body || {};
    const before = get(db, 'SELECT * FROM process_nodes WHERE id = ?', [req.params.id]);
    if (!before) throw ApiError.notFound("工艺节点不存在");
    const updates = [];
    const values = [];
    let validation = null;
    if (assigned_to !== undefined && assigned_to !== null && assigned_to !== "") {
      validation = validateAssignment(db, { process_node_id: Number(req.params.id), user_id: Number(assigned_to) });
      if (!validation.ok && !force) {
        throw ApiError.validation('人员资质不满足该工序要求', validation);
      }
      updates.push('assigned_to = ?'); values.push(Number(assigned_to));
    }
    if (required_workstation_id !== undefined) { updates.push('required_workstation_id = ?'); values.push(required_workstation_id); }
    if (updates.length === 0) throw ApiError.validation("无可更新字段");
    updates.push("updated_at = datetime('now')");
    values.push(before.id);
    const r = run(db, 'UPDATE process_nodes SET ' + updates.join(', ') + ' WHERE id = ?', values);
    audit.record(db, req, {
      action: "process_node.assign",
      resource_type: "process_node",
      resource_id: before.id,
      before: { assigned_to: before.assigned_to, required_workstation_id: before.required_workstation_id },
      after: { assigned_to, required_workstation_id, forced: !!force, validation_ok: validation ? validation.ok : null },
      diff_summary: `工序节点 ${before.id} 派工`,
    });
    res.json({ changes: r.changes, validation });
  }));



  app.get('/api/process_nodes/:id/efficiency', wrap((req, res) => {
    const node = get(db, 'SELECT id, operation_name, estimated_hours FROM process_nodes WHERE id = ?', [req.params.id]);
    if (!node) throw ApiError.notFound("工艺节点不存在");
    // 2026-11-06（WH-9）：实际工时优先取已审批报工，没有报工数据时回退工序执行工时
    const reportStatusAware = (() => {
      try { return db.prepare("PRAGMA table_info(work_report_details)").all().some((column) => column.name === "status"); }
      catch (_error) { return false; }
    })();
    const reportActual = get(db, "SELECT SUM(hours_spent) AS h FROM work_report_details WHERE process_node_id = ?" + (reportStatusAware ? " AND status='approved'" : ""), [req.params.id]);
    const execActual = get(db, "SELECT COALESCE(SUM(hours_worked), 0) h FROM process_executions WHERE process_node_id = ? AND action IN ('start', 'complete')", [req.params.id]);
    const actualHours = reportActual && reportActual.h !== null && reportActual.h !== undefined ? Number(reportActual.h) : Number(execActual && execActual.h || 0);
    const actualBasis = reportActual && reportActual.h !== null && reportActual.h !== undefined ? "work_reports" : "process_executions";
    res.json({
      node_id: node.id,
      operation_name: node.operation_name,
      estimated_hours: node.estimated_hours || 0,
      actual_hours: actualHours,
      actual_basis: actualBasis,
      efficiency_pct: node.estimated_hours ? Math.round((node.estimated_hours / (actualHours || 1)) * 100) : 0,
      variance: actualHours - (node.estimated_hours || 0)
    });
  }));

  // P2-#8 工艺参数记录
}

module.exports = { register };
