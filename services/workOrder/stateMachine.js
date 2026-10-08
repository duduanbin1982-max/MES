"use strict";
// services/workOrder/stateMachine.js
// F4 (brooks-audit): single authoritative work order state machine.
// Previously this logic was inlined 4 times in workOrderService.js with
// inconsistent mappings (e.g. "dispatched" was set in dispatch() but never
// observed in DB). All callers now go through transition().

const { ApiError } = require('../../app/errors');


// F6 follow-up: DB-level CHECK constraint on work_orders.status is not yet in place.
//   SQLite requires table rebuild to add CHECK; deferred because it requires downtime
//   and the in-app state machine now covers all transitions. To enable:
//     1. CREATE TABLE work_orders_new (... CHECK (status IN ('pending','dispatched',...)));
//     2. INSERT INTO work_orders_new SELECT * FROM work_orders;
//     3. DROP TABLE work_orders; ALTER TABLE work_orders_new RENAME TO work_orders;
//     4. Recreate indexes and FK references.


// Frozen status constants (F6: status drift prevention).
// DB-level CHECK constraint is a separate task (brooks-audit pending).
const WO_STATUS = Object.freeze({
  PENDING:      'pending',
  DISPATCHED:   'dispatched',
  IN_PROGRESS:  'in_progress',
  PAUSED:       'paused',
  COMPLETED:    'completed',
  CANCELLED:    'cancelled',
});

const ALL_STATUSES = Object.freeze(Object.values(WO_STATUS));

// Transition table: event -> { from, to, compute?(payload, wo) -> {to, extraSetters[]} }
const TRANSITIONS = {
  dispatch: {
    from: [WO_STATUS.PENDING],
    to: WO_STATUS.DISPATCHED,
    setters: ["dispatched_at = COALESCE(dispatched_at, datetime('now'))", "updated_at = datetime('now')"],
  },
  start: {
    from: [WO_STATUS.PENDING, WO_STATUS.DISPATCHED],
    to: WO_STATUS.IN_PROGRESS,
    setters: ["actual_start = COALESCE(actual_start, datetime('now'))", "updated_at = datetime('now')"],
  },
  pause: {
    from: [WO_STATUS.IN_PROGRESS],
    to: WO_STATUS.PAUSED,
    setters: ["updated_at = datetime('now')"],
  },
  complete: {
    from: [WO_STATUS.DISPATCHED, WO_STATUS.IN_PROGRESS, WO_STATUS.PAUSED],
    to: WO_STATUS.COMPLETED,
    setters: ["actual_end = COALESCE(actual_end, datetime('now'))", "updated_at = datetime('now')"],
  },
  // report uses compute() because new status depends on accumulated quantity
  report: {
    from: [WO_STATUS.DISPATCHED, WO_STATUS.IN_PROGRESS],
    to: null, // computed
    compute(payload, wo) {
      const qtyDone   = (wo.quantity_completed || 0) + (payload.quantity_completed || 0);
      const hrsDone   = (wo.actual_hours     || 0) + (payload.hours_worked     || 0);
      const reached   = qtyDone >= (wo.quantity_planned || 1);
      return {
        to: reached ? WO_STATUS.COMPLETED : wo.status,
        setters: [
          `actual_hours = ${hrsDone}`,
          `quantity_completed = ${qtyDone}`,
          ...(reached ? ["actual_end = COALESCE(actual_end, datetime('now'))"] : []),
          "updated_at = datetime('now')",
        ],
      };
    },
  },
  cancel: {
    from: [WO_STATUS.PENDING, WO_STATUS.DISPATCHED, WO_STATUS.IN_PROGRESS, WO_STATUS.PAUSED],
    to: WO_STATUS.CANCELLED,
    setters: ["updated_at = datetime('now')"],
  },
};

/**
 * Plan a work order transition. Returns { to, setters[] } or throws if invalid.
 * Caller is responsible for executing the UPDATE with the returned setters.
 *
 * @param {object} wo  current work_order row (must have .status)
 * @param {string} event  one of: dispatch, start, pause, complete, report, cancel
 * @param {object} [payload]  event-specific data (e.g. { quantity_completed, hours_worked } for report)
 * @returns {{ to: string, setters: string[] }}
 */
function plan(wo, event, payload = {}) {
  const t = TRANSITIONS[event];
  if (!t) {
    throw ApiError.validation(`Unknown work order event: ${event}`);
  }
  if (!t.from.includes(wo.status)) {
    throw ApiError.validation(`Cannot '${event}' from status '${wo.status}'`);
  }

  if (typeof t.compute === 'function') {
    const computed = t.compute(payload, wo);
    return { to: computed.to, setters: computed.setters };
  }

  return { to: t.to, setters: t.setters };
}

/**
 * Apply a planned transition by executing the UPDATE on the work_orders row.
 * @returns {string} new status
 */
function apply(wo, event, payload, run) {
  const { to, setters } = plan(wo, event, payload);
  const sql = `UPDATE work_orders SET status = '${to}', ${setters.join(', ')} WHERE id = ?`;
  run(sql, wo.id);
  return to;
}

module.exports = { WO_STATUS, ALL_STATUSES, TRANSITIONS, plan, apply };
