"use strict";

function createCaseStore({ db, audit, safeAll, safeGet }) {
  function actor(req) {
    return {
      id: req.user?.uid || req.user?.sub || req.user?.id || null,
      name: req.user?.full_name || req.user?.username || req.user?.name || null,
    };
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function caseFor(exceptionId) {
    return safeGet("SELECT * FROM exception_cases WHERE exception_id = ?", [exceptionId]);
  }

  function ensureCase(exceptionId, patch = {}) {
    const existing = caseFor(exceptionId);
    if (!existing) {
      db.prepare(`INSERT INTO exception_cases
        (exception_id, status, owner_id, owner_name, priority, due_at, last_action)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        exceptionId,
        patch.status || "open",
        patch.owner_id || null,
        patch.owner_name || null,
        patch.priority || null,
        patch.due_at || null,
        patch.last_action || null
      );
      return caseFor(exceptionId);
    }

    const fields = [];
    const params = [];
    for (const key of ["status", "owner_id", "owner_name", "priority", "due_at", "closed_at", "closed_by", "close_note", "last_action"]) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${key} = ?`);
        params.push(patch[key]);
      }
    }
    if (fields.length) {
      fields.push("updated_at = datetime('now')");
      params.push(exceptionId);
      db.prepare(`UPDATE exception_cases SET ${fields.join(", ")} WHERE exception_id = ?`).run(params);
    }
    return caseFor(exceptionId);
  }

  function addAction(req, exceptionId, action, note, patch = {}) {
    const ownerId = Object.prototype.hasOwnProperty.call(patch, "owner_id") ? patch.owner_id : null;
    const ownerName = Object.prototype.hasOwnProperty.call(patch, "owner_name") ? patch.owner_name : null;
    const currentActor = actor(req);
    db.prepare(`INSERT INTO exception_actions
      (exception_id, action, note, owner_id, owner_name, created_by, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(exceptionId, action, note || null, ownerId, ownerName, currentActor.id, currentActor.name);
    audit.record(db, req, {
      action: `exception.${action}`,
      resource_type: "exception",
      resource_id: exceptionId,
      after: { exception_id: exceptionId, action, note, ...patch },
    });
  }

  function actionsFor(exceptionId) {
    return safeAll("SELECT * FROM exception_actions WHERE exception_id = ? ORDER BY id DESC", [exceptionId]);
  }

  return { actionsFor, actor, addAction, caseFor, ensureCase, today };
}

module.exports = { createCaseStore };
