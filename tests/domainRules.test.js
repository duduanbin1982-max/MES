const test = require("node:test");
const assert = require("node:assert/strict");

const { buildKitRiskComponents, summarizeKitRisk } = require("../app/domain/bomRisk");
const { canTransitionLifecycle, normalizeLifecycleStatus } = require("../app/domain/equipmentInstance");
const { isShortageActive, isShortageFulfilled, isShortageResolved, nextShortageStateForFollowup } = require("../app/domain/shortageCase");
const { PROCESS_ROUTE_GAPS, assessProcessRoute, summarizeProcessRoutes } = require("../app/domain/processRoute");
const { buildDeliveryStage, summarizeDeliveryWorkflow } = require("../app/domain/projectDelivery");
const { appendClosureNote, evaluateNcrClosure } = require("../app/domain/qualityNcr");

test("BOM kit risks are sorted by blockage and amount", () => {
  const risks = buildKitRiskComponents([
    { component_id: 1, kit_status: "incoming", shortage_amount: 100, risk_items: [] },
    { component_id: 2, kit_status: "blocked", shortage_amount: 10, risk_items: [{ owners: ["采购"], purchase_orders: [{ id: 1 }] }] },
    { component_id: 3, kit_status: "ready", shortage_amount: 999, risk_items: [] },
  ]);
  assert.deepEqual(risks.map((item) => item.component_id), [2, 1]);
  assert.equal(summarizeKitRisk([{ kit_status: "ready" }, { kit_status: "blocked" }], risks).blocked_count, 1);
});

test("NCR closure requires disposition, CAPA closed and pass/accept", () => {
  const blocked = evaluateNcrClosure({ disposition: "repair" }, [{ status: "open" }], []);
  assert.equal(blocked.canClose, false);
  assert.ok(blocked.blockers.includes("CAPA 未全部关闭"));

  const closable = evaluateNcrClosure({ disposition: "repair" }, [{ status: "closed" }], [{ result: "pass" }]);
  assert.equal(closable.canClose, true);
  assert.equal(appendClosureNote("原因", "已复检"), "原因\n关闭说明: 已复检");
});

test("shortage followup state maps drive close and reopen loops", () => {
  assert.equal(isShortageActive("open"), true);
  assert.equal(isShortageResolved("closed"), true);
  assert.equal(isShortageActive("received"), false);
  assert.equal(isShortageFulfilled("received"), true);
  assert.equal(isShortageFulfilled("cancelled"), false);
  assert.equal(nextShortageStateForFollowup("arrived"), "closed");
  assert.equal(nextShortageStateForFollowup("cancelled"), "reopened");
});

test("process route owns gap codes and completeness summary", () => {
  const missing = assessProcessRoute({ id: 1 }, [{ estimated_hours: 0, required_workstation_id: null, required_skill: "" }]);
  assert.deepEqual(missing.gap_codes, [
    PROCESS_ROUTE_GAPS.MISSING_HOURS,
    PROCESS_ROUTE_GAPS.MISSING_WORKSTATION,
    PROCESS_ROUTE_GAPS.MISSING_SKILL,
  ]);
  const complete = assessProcessRoute({ id: 2 }, [{ estimated_hours: 4, required_workstation_id: 3, required_skill: "welding" }]);
  const summary = summarizeProcessRoutes([missing, complete]);
  assert.equal(summary.component_count, 2);
  assert.equal(summary.complete_count, 1);
  assert.equal(summary.missing_hours_count, 1);
});

test("project delivery owns stage and workflow status", () => {
  const percentage = (done, total) => total ? Math.round(done * 100 / total) : 0;
  const stage = buildDeliveryStage({
    key: "purchase",
    label: "采购",
    done: 1,
    total: 3,
    path: "/purchase",
    blockers: [{ severity: "high", title: "采购延期" }],
  }, percentage);
  assert.equal(stage.status, "blocked");
  assert.equal(stage.percent, 33);
  const workflow = summarizeDeliveryWorkflow([stage]);
  assert.equal(workflow.status, "blocked");
  assert.equal(workflow.blockers[0].stage_key, "purchase");
});

test("equipment lifecycle permits only defined transitions", () => {
  assert.equal(canTransitionLifecycle("design", "procurement"), true);
  assert.equal(canTransitionLifecycle("design", "delivered"), false);
  assert.equal(canTransitionLifecycle("procurement", "manufacturing"), true);
  assert.equal(canTransitionLifecycle("manufacturing", "delivered"), false);
});

test("equipment lifecycle normalizes legacy stage vocabulary", () => {
  assert.equal(normalizeLifecycleStatus("designing"), "design");
  assert.equal(normalizeLifecycleStatus("purchasing"), "procurement");
  assert.equal(canTransitionLifecycle("designing", "purchasing"), true);
});
