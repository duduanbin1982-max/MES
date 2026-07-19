const test = require("node:test");
const assert = require("node:assert/strict");

const { buildKitRiskComponents, summarizeKitRisk } = require("../app/domain/bomTree");
const { canTransitionLifecycle, normalizeLifecycleStatus } = require("../app/domain/equipmentInstance");
const { isShortageActive, isShortageResolved, nextShortageStateForFollowup } = require("../app/domain/purchaseShortage");
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
  assert.equal(nextShortageStateForFollowup("arrived"), "closed");
  assert.equal(nextShortageStateForFollowup("cancelled"), "reopened");
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
