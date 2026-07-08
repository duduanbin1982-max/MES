"use strict";
// services/delivery/routes.js

function registerDeliveryRoutes(app, ctx) {
  const {
    wrap,
    readModel,
    safeGet,
    caseFor,
    ensureCase,
    addAction,
    actionsFor,
    actor,
    today,
    syncSourceAssign,
    syncSourceStart,
    syncSourceClose,
    syncSourceReopen,
    restartPurchaseFollowup,
    sendExceptionNotice,
    alreadyNotifiedToday,
  } = ctx;
  const { collectExceptions, exceptionSummary, getInstances, buildProject, buildProjectRiskDrilldown } = readModel;

  app.get("/api/delivery/projects", wrap((req, res) => {
    const exceptions = collectExceptions();
    const projects = getInstances().map((i) => buildProject(i, exceptions));
    const risk = req.query.risk;
    const filtered = risk ? projects.filter((p) => p.risk_level === risk) : projects;
    res.json({ projects: filtered, total: filtered.length });
  }));

  app.get("/api/delivery/projects/:id/risks", wrap((req, res) => {
    const id = Number(req.params.id);
    const instance = getInstances().find((i) => Number(i.id) === id);
    if (!instance) return res.status(404).json({ error: "project not found" });
    const exceptions = collectExceptions();
    res.json(buildProjectRiskDrilldown(instance, exceptions));
  }));

  app.get("/api/delivery/projects/:id", wrap((req, res) => {
    const id = Number(req.params.id);
    const instance = getInstances().find((i) => Number(i.id) === id);
    if (!instance) return res.status(404).json({ error: "project not found" });
    const exceptions = collectExceptions();
    res.json({ project: buildProject(instance, exceptions), exceptions: exceptions.filter((e) => Number(e.instance_id) === id) });
  }));

  app.get("/api/delivery/overview", wrap((req, res) => {
    const exceptions = collectExceptions();
    const projects = getInstances().map((i) => buildProject(i, exceptions));
    const avgProgress = projects.length ? Math.round(projects.reduce((s, p) => s + p.progress_pct, 0) / projects.length) : 0;
    const riskProjects = projects.filter((p) => p.risk_level !== "normal").length;
    const criticalProjects = projects.filter((p) => p.risk_level === "critical").length;
    const blockedProjects = projects.filter((p) => p.workflow_status === "blocked").length;
    const workflowBlockers = projects.reduce((sum, p) => sum + Number(p.workflow_blocker_count || 0), 0);
    res.json({
      summary: {
        total_projects: projects.length,
        avg_progress: avgProgress,
        risk_projects: riskProjects,
        critical_projects: criticalProjects,
        blocked_projects: blockedProjects,
        workflow_blockers: workflowBlockers,
        open_exceptions: exceptions.length,
      },
      exception_summary: exceptionSummary(exceptions),
      workflow: {
        columns: ["contract", "bom", "documents", "process", "purchase", "kit", "work_orders", "report", "quality", "cost", "acceptance"],
        blocker_count: workflowBlockers,
        blocked_projects: blockedProjects,
      },
      projects,
    });
  }));

  app.get("/api/delivery/workflow", wrap((req, res) => {
    const exceptions = collectExceptions();
    const projects = getInstances().map((i) => buildProject(i, exceptions));
    res.json({
      columns: ["contract", "bom", "documents", "process", "purchase", "kit", "work_orders", "report", "quality", "cost", "acceptance"],
      projects: projects.map((p) => ({
        id: p.id,
        instance_code: p.instance_code,
        instance_name: p.instance_name,
        customer_name: p.customer_name,
        lifecycle_stage: p.lifecycle_stage,
        risk_level: p.risk_level,
        workflow_status: p.workflow_status,
        workflow_blocker_count: p.workflow_blocker_count,
        stages: p.stages,
      })),
    });
  }));

  app.get("/api/exceptions", wrap((req, res) => {
    let items = collectExceptions();
    if (req.query.include_closed !== "1") items = items.filter((i) => i.case_status !== "closed");
    if (req.query.severity) items = items.filter((i) => i.severity === req.query.severity);
    if (req.query.type) items = items.filter((i) => i.type === req.query.type);
    if (req.query.status) items = items.filter((i) => i.case_status === req.query.status);
    if (req.query.owner_id) items = items.filter((i) => Number(i.owner_id) === Number(req.query.owner_id));
    if (req.query.instance_id) items = items.filter((i) => Number(i.instance_id) === Number(req.query.instance_id));
    const limit = Math.min(Number(req.query.limit || 200), 500);
    res.json({ items: items.slice(0, limit), summary: exceptionSummary(items) });
  }));

  app.get("/api/exceptions/summary", wrap((_req, res) => {
    const items = collectExceptions();
    res.json(exceptionSummary(items));
  }));


  app.get("/api/exceptions/:id", wrap((req, res) => {
    const item = collectExceptions().find((i) => i.id === req.params.id);
    if (!item) {
      const c = caseFor(req.params.id);
      if (!c) return res.status(404).json({ error: "exception not found" });
      return res.json({
        item: {
          id: req.params.id,
          type: "closed_source",
          severity: c.priority || "info",
          title: req.params.id,
          message: c.close_note || c.last_action || "源单据已关闭或不再触发异常",
          case_status: c.status || "closed",
          owner_id: c.owner_id,
          owner_name: c.owner_name,
          due_at: c.due_at,
          closed_at: c.closed_at,
          action_label: "已归档",
        },
        case: c,
        actions: actionsFor(req.params.id),
      });
    }
    res.json({ item, case: caseFor(req.params.id), actions: actionsFor(req.params.id) });
  }));

  app.post("/api/exceptions/:id/assign", wrap((req, res) => {
    const id = req.params.id;
    const userId = Number(req.body?.owner_id || 0);
    const user = userId ? safeGet("SELECT id, full_name, username FROM users WHERE id = ?", [userId]) : null;
    if (!user) return res.status(400).json({ error: "owner_id required" });
    const ownerName = user.full_name || user.username || String(user.id);
    syncSourceAssign(id, user, { due_at: req.body?.due_at || null, note: req.body?.note || null });
    const c = ensureCase(id, {
      status: "assigned",
      owner_id: user.id,
      owner_name: ownerName,
      priority: req.body?.priority || null,
      due_at: req.body?.due_at || null,
      last_action: "assign",
    });
    addAction(req, id, "assign", req.body?.note || `分派给 ${ownerName}`, { owner_id: user.id, owner_name: ownerName });
    res.json({ ok: true, case: c, actions: actionsFor(id) });
  }));

  app.post("/api/exceptions/:id/action", wrap((req, res) => {
    const id = req.params.id;
    const action = req.body?.action || "comment";
    const status = action === "start" ? "processing" : (req.body?.status || undefined);
    if (action === "start") syncSourceStart(id, req.body?.note || null);
    const c = ensureCase(id, { ...(status ? { status } : {}), last_action: action });
    addAction(req, id, action, req.body?.note || null, {});
    res.json({ ok: true, case: c, actions: actionsFor(id) });
  }));

  app.get("/api/exceptions/escalation-rules/list", wrap((_req, res) => {
    defaultEscalationRules();
    res.json(safeAll("SELECT * FROM exception_escalation_rules ORDER BY is_active DESC, id"));
  }));

  app.post("/api/exceptions/:id/notify", wrap(async (req, res) => {
    const item = collectExceptions().find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: "exception not found" });
    const result = await sendExceptionNotice(req, item, "notify", req.body?.note || null, req.body?.target_role || item.escalation_to_role || null);
    res.json({ ok: true, result });
  }));

  app.post("/api/exceptions/:id/escalate", wrap(async (req, res) => {
    const item = collectExceptions().find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: "exception not found" });
    const target = req.body?.target_role || item.escalation_to_role || "负责人";
    const result = await sendExceptionNotice(req, item, "escalate", req.body?.note || `升级给 ${target}`, target);
    ensureCase(item.id, { status: "processing", priority: item.priority || item.severity, last_action: "escalate" });
    res.json({ ok: true, result });
  }));

  app.post("/api/exceptions/escalate-due", wrap(async (req, res) => {
    const items = collectExceptions().filter((item) => item.escalation_due && item.case_status !== "closed");
    const limit = Math.min(Number(req.body?.limit || 20), 100);
    const sent = [];
    for (const item of items.slice(0, limit)) {
      if (alreadyNotifiedToday(item.id, "escalate")) continue;
      ensureCase(item.id, { status: "processing", priority: item.priority || item.severity, last_action: "auto_escalate" });
      const result = await sendExceptionNotice(null, item, "escalate", "自动升级：超出规则时限", item.escalation_to_role || null);
      sent.push({ id: item.id, ok: result?.ok !== false, skipped: result?.skipped || false, target_role: item.escalation_to_role });
    }
    res.json({ ok: true, total_due: items.length, sent });
  }));

  app.post("/api/exceptions/:id/close", wrap((req, res) => {
    const id = req.params.id;
    const a = actor(req);
    const note = req.body?.note || "已关闭";
    const linked = syncSourceClose(id, note);
    if (!linked.ok) return res.status(400).json({ error: linked.message || "源单据未满足关闭条件" });
    const c = ensureCase(id, {
      status: "closed",
      closed_at: today(),
      closed_by: a.id,
      close_note: note,
      last_action: "close",
    });
    addAction(req, id, "close", note, {});
    res.json({ ok: true, case: c, actions: actionsFor(id) });
  }));

  app.post("/api/exceptions/:id/reopen", wrap((req, res) => {
    const id = req.params.id;
    syncSourceReopen(id, req.body?.note || null);
    const c = ensureCase(id, {
      status: "open",
      closed_at: null,
      closed_by: null,
      close_note: null,
      last_action: "reopen",
    });
    addAction(req, id, "reopen", req.body?.note || "重新打开", {});
    res.json({ ok: true, case: c, actions: actionsFor(id) });
  }));

  app.post("/api/exceptions/:id/restart-purchase-followup", wrap((req, res) => {
    const id = req.params.id;
    const note = req.body?.note || "异常中心重新发起采购催办";
    const result = restartPurchaseFollowup(id, note);
    if (!result.ok) return res.status(400).json({ error: result.message || "重新发起采购催办失败" });
    const shortage = result.shortage || {};
    const c = ensureCase(id, {
      status: shortage.owner_id ? "assigned" : "processing",
      owner_id: shortage.owner_id || null,
      owner_name: shortage.owner_name || null,
      priority: shortage.priority || null,
      due_at: shortage.expected_date || null,
      closed_at: null,
      closed_by: null,
      close_note: null,
      last_action: "restart_purchase_followup",
    });
    addAction(req, id, "restart_followup", note, {
      owner_id: shortage.owner_id || null,
      owner_name: shortage.owner_name || null,
    });
    res.json({ ok: true, result, case: c, actions: actionsFor(id) });
  }));
}

module.exports = { registerDeliveryRoutes };
