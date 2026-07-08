"use strict";
// app/workflow/engine.js
// P0-5 工作流引擎 (状态机)
//   - start(definitionName, entityType, entityId, initData): 启动工作流
//   - transit(instanceId, action, actor, comment): 执行状态迁移
//   - getAvailableActions(instanceId): 查询当前可执行动作
//   - getInstance(instanceId): 获取实例 + 历史
// Author: 三狗子 | Date: 2026-06-25

const { definitions } = require("./definitions");
const { emit, Events } = require("../ws/EventBus");

function createEngine(db) {
  const all = (sql, p = []) => db.prepare(sql).all(p);
  const get = (sql, p = []) => db.prepare(sql).get(p);
  const run = (sql, p = []) => db.prepare(sql).run(p);

  function getDef(name) {
    const def = definitions[name];
    if (!def) throw Object.assign(new Error("未知工作流: " + name), { status: 404 });
    return def;
  }

  function safeParse(str) {
    if (!str) return {};
    try { return JSON.parse(str); } catch (_e) { return {}; }
  }

  function start(definitionName, entityType, entityId, initData) {
    initData = initData || {};
    const def = getDef(definitionName);
    if (def.entity_type !== entityType) {
      throw Object.assign(new Error("entity_type 不匹配: " + def.entity_type + " vs " + entityType), { status: 400 });
    }
    const initial = def.states[0];

    const result = db.transaction(() => {
      const r = run(
        "INSERT INTO workflow_instances (definition_name, entity_type, entity_id, current_state, assigned_to, priority, data, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [definitionName, entityType, entityId, initial.id, initData.assigned_to || null, initData.priority || 0, JSON.stringify(initData.data || {}), initData.created_by || null]
      );
      const id = Number(r.lastInsertRowid);
      run("INSERT INTO workflow_history (instance_id, from_state, to_state, action, actor_id, comment) VALUES (?, NULL, ?, 'start', ?, ?)",
        [id, initial.id, initData.created_by || null, initData.comment || null]);
      const inst = get("SELECT * FROM workflow_instances WHERE id = ?", id);
      if (inst) inst.data = safeParse(inst.data);
      const hist = all("SELECT * FROM workflow_history WHERE instance_id = ? ORDER BY id", id);
      return { instance: inst, history: hist };
    })();

    emit(Events.WORKFLOW_STARTED, { def_name: definitionName, entity_type: entityType, entity_id: entityId, instance_id: result.instance.id });
    return result;
  }

  function transit(instanceId, action, actorId, comment, extraData) {
    extraData = extraData || {};
    const instance = get("SELECT * FROM workflow_instances WHERE id = ?", instanceId);
    if (!instance) throw Object.assign(new Error("实例不存在: " + instanceId), { status: 404 });
    if (instance.completed_at) throw Object.assign(new Error("工作流已结束"), { status: 400 });

    const def = getDef(instance.definition_name);
    const trans = def.transitions.find(t => t.from === instance.current_state && t.action === action);
    if (!trans) {
      const avail = def.transitions.filter(t => t.from === instance.current_state).map(t => t.action);
      throw Object.assign(new Error("不可执行 \"" + action + "\", 可用: [" + avail.join(",") + "]"), { status: 400, available: avail });
    }

    if (trans.guard && !trans.guard(instance, actorId, extraData)) {
      throw Object.assign(new Error("guard 条件不满足"), { status: 403 });
    }

    const toState = def.states.find(s => s.id === trans.to);
    if (!toState) throw Object.assign(new Error("目标状态不存在: " + trans.to), { status: 500 });

    const result = db.transaction(() => {
      const ups = ["current_state = ?", "updated_at = CURRENT_TIMESTAMP"];
      const params = [trans.to];
      if (extraData.assigned_to !== undefined) { ups.push("assigned_to = ?"); params.push(extraData.assigned_to); }
      if (extraData.due_date !== undefined) { ups.push("due_date = ?"); params.push(extraData.due_date); }
      if (extraData.priority !== undefined) { ups.push("priority = ?"); params.push(extraData.priority); }
      if (extraData.data) {
        const existing = safeParse(instance.data);
        Object.assign(existing, extraData.data);
        ups.push("data = ?"); params.push(JSON.stringify(existing));
      }
      if (toState.is_terminal) { ups.push("completed_at = CURRENT_TIMESTAMP"); }
      params.push(instanceId);
      run("UPDATE workflow_instances SET " + ups.join(", ") + " WHERE id = ?", params);
      run("INSERT INTO workflow_history (instance_id, from_state, to_state, action, actor_id, comment, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [instanceId, instance.current_state, trans.to, action, actorId || null, comment || null, extraData.data ? JSON.stringify(extraData.data) : null]);
      const updated = get("SELECT * FROM workflow_instances WHERE id = ?", instanceId);
      if (updated) updated.data = safeParse(updated.data);
      const hist = all("SELECT * FROM workflow_history WHERE instance_id = ? ORDER BY id", instanceId);
      return { instance: updated, history: hist };
    })();

    emit(Events.WORKFLOW_TRANSITED, {
      instance_id: instanceId, def_name: instance.definition_name,
      entity_type: instance.entity_type, entity_id: instance.entity_id,
      from_state: instance.current_state, to_state: trans.to, action, actor_id: actorId
    });
    return result;
  }

  function getAvailableActions(instanceId) {
    const inst = get("SELECT * FROM workflow_instances WHERE id = ?", instanceId);
    if (!inst || inst.completed_at) return [];
    const def = getDef(inst.definition_name);
    return def.transitions.filter(t => t.from === inst.current_state).map(t => ({ action: t.action, label: t.label || t.action, to: t.to }));
  }

  function getInstance(instanceId) {
    const inst = get("SELECT * FROM workflow_instances WHERE id = ?", instanceId);
    if (!inst) return null;
    inst.data = safeParse(inst.data);
    inst.history = all("SELECT wh.*, u.full_name as actor_name FROM workflow_history wh LEFT JOIN users u ON wh.actor_id = u.id WHERE wh.instance_id = ? ORDER BY wh.id", instanceId);
    inst.available_actions = inst.completed_at ? [] : getAvailableActions(instanceId);
    return inst;
  }

  function getInstancesByEntity(entityType, entityId) {
    return all("SELECT * FROM workflow_instances WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC", [entityType, entityId])
      .map(r => { r.data = safeParse(r.data); return r; });
  }

  return { start, transit, getAvailableActions, getInstance, getInstancesByEntity };
}

module.exports = { createEngine };
