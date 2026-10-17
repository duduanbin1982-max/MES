"use strict";

const { createLogger } = require("../app/logger");
const logger = createLogger("workflowService");
const { wrap } = require('../middleware/asyncHandler');
// services/workflowService.js
// P0-5 工作流 HTTP API
//   POST /api/workflow/start         启动工作流
//   POST /api/workflow/:id/transit   执行迁移
//   GET  /api/workflow/:id           查看实例详情
//   GET  /api/workflow/entity        查实体关联的流程
//   GET  /api/workflow/definitions   列出可用工作流定义
// Author: 三狗子 | Date: 2026-06-25

const { ApiError } = require("../app/errors");

function register(app, db, auth) {
  // definitions 端点公开可读 (不经过 app.use 全局中间件)
  const { definitions } = require("../app/workflow/definitions");
const timeline = require("./workflow/timeline");

  // 2026-10-17：把代码里的定义幂等同步到 workflow_definitions 表
  // （定义仍以代码为准；落库便于查询/审计/前端下拉，不再出现"表空但功能可用"的错觉）
  try {
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uk_workflow_definitions_name ON workflow_definitions(name)").run();
    const upsert = db.prepare(
      `INSERT INTO workflow_definitions (name, display_name, entity_type, description, states, transitions, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(name) DO UPDATE SET
         display_name = excluded.display_name,
         entity_type  = excluded.entity_type,
         description  = excluded.description,
         states       = excluded.states,
         transitions  = excluded.transitions,
         updated_at   = datetime('now')`
    );
    for (const [name, def] of Object.entries(definitions)) {
      upsert.run(
        name,
        def.display_name,
        def.entity_type,
        def.description || null,
        JSON.stringify(def.states),
        JSON.stringify(def.transitions.map((t) => ({ from: t.from, to: t.to, action: t.action, label: t.label || t.action })))
      );
    }
  } catch (error) {
    // 落库失败不影响定义读取（定义一直在代码里）
    logger.warn("[workflow] definitions 落库失败: " + error.message);
  }
  const { createEngine } = require("../app/workflow/engine");
  const wf = createEngine(db);

  // Static routes must be registered before /:id, otherwise Express treats
  // "definitions" as a workflow instance id.
  app.get("/api/workflow/definitions", wrap((_req, res) => {
    const list = Object.entries(definitions).map(([name, def]) => ({
      name,
      display_name: def.display_name,
      entity_type: def.entity_type,
      description: def.description,
      states: def.states,
      transitions_count: def.transitions.length,
    }));
    res.json(list);
  }));

  // 启动工作流
  app.post("/api/workflow/start", wrap((req, res) => {
    const { definition_name, entity_type, entity_id, assigned_to, priority, data, comment } = req.body;
    if (!definition_name || !entity_type || entity_id === undefined) {
      throw ApiError.validation("definition_name/entity_type/entity_id 必填")
    }
    const result = wf.start(definition_name, entity_type, Number(entity_id), {
      assigned_to: assigned_to || (req.user && req.user.sub),
      priority: priority || 0,
      data: data || {},
      created_by: req.user && req.user.sub,
      comment,
    });
    res.status(201).json(result);
  }));

  // 状态迁移
  app.post("/api/workflow/:id/transit", wrap((req, res) => {
    const { action, comment, assigned_to, due_date, data, effective_date, closed_date } = req.body;
    if (!action) throw ApiError.validation("action 必填")
    const extra = {};
    if (assigned_to !== undefined) extra.assigned_to = assigned_to;
    if (due_date !== undefined) extra.due_date = due_date;
    if (effective_date) extra.effective_date = effective_date;
    if (closed_date) extra.closed_date = closed_date;
    if (data) extra.data = data;
    const result = wf.transit(Number(req.params.id), action, req.user && req.user.sub, comment, extra);
    res.json(result);
  }));

  // 查询实例
  app.get("/api/workflow/:id", wrap((req, res) => {
    const inst = wf.getInstance(Number(req.params.id));
    if (!inst) throw ApiError.notFound("not found")
    res.json(inst);
  }));

  // 按实体查询
  // 2026-10-17：统一 timeline 形状（与 /api/work_orders/:id/workflow 一致），
  // 任意实体都能拿到 实例 + 历史 + 当前状态下的可用动作，前端复用同一套渲染。
  // 2026-10-17 统一读取口径：工单 / ECO / 文档 都走 services/workflow/timeline.js
  // 返回 { entity_type, entity_id, definition, entity, current_state,
  //        available_actions, sources, history(倒序), instances }
  app.get("/api/workflow/entity/:type/:id", wrap((req, res) => {
    res.json(timeline.getTimeline(db, req.params.type, Number(req.params.id)));
  }));

  app.get("/api/workflow/:id/actions", wrap((req, res) => {
    const actions = wf.getAvailableActions(Number(req.params.id));
    res.json(actions);
  }));
}

module.exports = { register };
