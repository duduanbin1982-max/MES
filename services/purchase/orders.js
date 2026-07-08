// services/purchase/orders.js
// 采购订单服务门面：装配订单路由、跟催路由与采购跟踪表
"use strict";

const { makeHelpers } = require("./_helpers");
const { PURCHASE_ORDER_STATUSES: PO_STATUSES } = require("../../app/domain/statusCatalog");
const { ensurePurchaseTracking } = require("./trackingStore");
const { registerPurchaseOrderRoutes } = require("./orderRoutes");
const { registerPurchaseFollowupRoutes } = require("./followupRoutes");

function register(app, db) {
  const helpers = makeHelpers(db);
  ensurePurchaseTracking(db);
  registerPurchaseOrderRoutes(app, db, helpers);
  registerPurchaseFollowupRoutes(app, db, helpers);
}

module.exports = {
  register,
  PO_STATUSES,
};
