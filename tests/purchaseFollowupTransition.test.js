"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveFollowupTransition,
  targetShortageIdsForTracking,
} = require("../services/purchase/followupEffects");
const { purchaseFollowupPath } = require("../services/delivery/readModel/purchaseFollowups");

const NOW = new Date("2026-07-10T00:00:00Z").getTime();

test("purchase follow-up: shared path builder preserves filters", () => {
  assert.equal(purchaseFollowupPath(), "/purchase?tab=followup");
  assert.equal(
    purchaseFollowupPath(7, "PR 2026/001"),
    "/purchase?tab=followup&instance_id=7&purchase_request_no=PR%202026%2F001"
  );
});

test("purchase follow-up: actual delivery drives delivered + shortage close", () => {
  const transition = deriveFollowupTransition(
    { status: "following", planned_delivery: "2026-07-01", actual_delivery: null },
    { actual_delivery: "2026-07-03" },
    NOW
  );
  assert.equal(transition.nextTrackingStatus, "delivered");
  assert.equal(transition.shouldCloseShortages, true);
  assert.equal(transition.derivedShortageStatus, "closed");
  assert.ok(transition.sets.includes("status = ?"));
  assert.ok(transition.sets.includes("delay_days = ?"));
});

test("purchase follow-up: cancelled reopens shortage and clears purchase request", () => {
  const transition = deriveFollowupTransition(
    { status: "following", planned_delivery: null, actual_delivery: null, owner_id: null, owner_name: null },
    { status: "cancelled" },
    NOW
  );
  assert.equal(transition.nextTrackingStatus, "cancelled");
  assert.equal(transition.shouldReopenShortages, true);
  assert.equal(transition.derivedShortageStatus, "open");
});

test("purchase follow-up: terminal record moved back to following reopens as purchasing when ETA exists", () => {
  const transition = deriveFollowupTransition(
    { status: "delivered", planned_delivery: "2026-07-01", actual_delivery: "2026-07-02", owner_id: null, owner_name: null },
    { status: "following", planned_delivery: "2026-07-20", actual_delivery: null },
    NOW
  );
  assert.equal(transition.nextTrackingStatus, "following");
  assert.equal(transition.shouldReopenShortages, true);
  assert.equal(transition.derivedShortageStatus, "purchasing");
});

test("purchase follow-up: ETA or owner turns pending into following and assigns shortage", () => {
  const transition = deriveFollowupTransition(
    { status: "pending", planned_delivery: null, actual_delivery: null, owner_id: null, owner_name: null },
    { planned_delivery: "2026-07-20", owner_id: 7, owner_name: "采购员" },
    NOW
  );
  assert.equal(transition.nextTrackingStatus, "following");
  assert.equal(transition.shouldCloseShortages, false);
  assert.equal(transition.shouldReopenShortages, false);
  assert.equal(transition.derivedShortageStatus, "purchasing");
});

test("purchase follow-up: target shortage ids include virtual shortage source", () => {
  assert.deepEqual(
    targetShortageIdsForTracking({ source_type: "shortage", source_ref_id: 9, linked_shortage_ids: "[9,10]" }),
    [9, 9, 10]
  );
});
