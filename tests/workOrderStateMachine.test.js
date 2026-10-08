"use strict";
// tests/workOrderStateMachine.test.js
// Unit tests for F4 refactor: state machine should be the single authority.

const test = require("node:test");
const assert = require("node:assert/strict");
const sm = require("../services/workOrder/stateMachine");

function wo(status, extra = {}) {
  return Object.assign({
    id: 1, status, quantity_completed: 0, quantity_planned: 1,
    actual_hours: 0, dispatched_at: null, actual_start: null, actual_end: null,
  }, extra);
}

function fakeRun(captured) {
  return (sql, params) => {
    captured.push({ sql, params });
    return { changes: 1, lastInsertRowid: 1 };
  };
}

test("F4.1: start from pending -> in_progress with actual_start", () => {
  const cap = [];
  const run = fakeRun(cap);
  const newStatus = sm.apply(wo("pending"), "start", {}, run);
  assert.equal(newStatus, "in_progress");
  assert.equal(cap.length, 1);
  assert.match(cap[0].sql, /status = 'in_progress'/);
  assert.match(cap[0].sql, /actual_start = COALESCE/);
});

test("F4.2: dispatch from pending -> dispatched with dispatched_at", () => {
  const cap = [];
  const newStatus = sm.apply(wo("pending"), "dispatch", {}, fakeRun(cap));
  assert.equal(newStatus, "dispatched");
  assert.match(cap[0].sql, /status = 'dispatched'/);
  assert.match(cap[0].sql, /dispatched_at = COALESCE/);
});

test("F4.3: pause from in_progress -> paused", () => {
  const cap = [];
  const newStatus = sm.apply(wo("in_progress"), "pause", {}, fakeRun(cap));
  assert.equal(newStatus, "paused");
});

test("F4.4: complete from in_progress -> completed with actual_end", () => {
  const cap = [];
  const newStatus = sm.apply(wo("in_progress"), "complete", {}, fakeRun(cap));
  assert.equal(newStatus, "completed");
  assert.match(cap[0].sql, /actual_end = COALESCE/);
});

test("F4.5: report below planned keeps status, accumulates hours/qty", () => {
  const cap = [];
  const w = wo("in_progress", { quantity_planned: 10, quantity_completed: 3 });
  const newStatus = sm.apply(w, "report", { quantity_completed: 2, hours_worked: 1.5 }, fakeRun(cap));
  assert.equal(newStatus, "in_progress");  // not yet completed
  assert.match(cap[0].sql, /quantity_completed = 5/);
  assert.match(cap[0].sql, /actual_hours = 1\.5/);
});

test("F4.6: report reaching planned -> completed with actual_end", () => {
  const cap = [];
  const w = wo("in_progress", { quantity_planned: 5, quantity_completed: 3 });
  const newStatus = sm.apply(w, "report", { quantity_completed: 2, hours_worked: 1 }, fakeRun(cap));
  assert.equal(newStatus, "completed");
  assert.match(cap[0].sql, /actual_end = COALESCE/);
  assert.match(cap[0].sql, /quantity_completed = 5/);
});

test("F4.7: invalid transition throws VALIDATION_ERROR (was: silently doing nothing)", () => {
  // Before F4: dispatch() did 'UPDATE ... status = dispatched' regardless of current status.
  //   The 'pending' guard was in dispatch() but inline; other endpoints had no guard.
  // After F4: any invalid from-state throws.
  assert.throws(
    () => sm.plan(wo("completed"), "start"),
    (err) => err.code === "VALIDATION_ERROR"
  );
});

test("F4.8: unknown event throws VALIDATION_ERROR", () => {
  assert.throws(
    () => sm.plan(wo("pending"), "frobnicate"),
    (err) => err.code === "VALIDATION_ERROR"
  );
});

test("F4.9: cancel works from any non-terminal state", () => {
  for (const from of ["pending", "dispatched", "in_progress", "paused"]) {
    const cap = [];
    const newStatus = sm.apply(wo(from), "cancel", {}, fakeRun(cap));
    assert.equal(newStatus, "cancelled", `cancel from ${from}`);
  }
  // But not from completed or cancelled
  assert.throws(() => sm.plan(wo("completed"), "cancel"), (err) => err.code === "VALIDATION_ERROR");
  assert.throws(() => sm.plan(wo("cancelled"), "cancel"), (err) => err.code === "VALIDATION_ERROR");
});

test("F4.10: ALL_STATUSES is frozen and complete", () => {
  assert.ok(Object.isFrozen(sm.ALL_STATUSES));
  assert.deepEqual(
    [...sm.ALL_STATUSES].sort(),
    ["cancelled", "completed", "dispatched", "in_progress", "paused", "pending"]
  );
});
