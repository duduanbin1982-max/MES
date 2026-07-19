"use strict";

const { ApiError } = require("../../app/errors");

const EPSILON = 0.000001;
const DEFAULT_LOCATION = "主仓库-A-01";

function roundQty(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function dbAll(db, sql, params = []) {
  return db.prepare(sql).all(Array.isArray(params) ? params : [params]);
}

function dbGet(db, sql, params = []) {
  return db.prepare(sql).get(Array.isArray(params) ? params : [params]);
}

function dbRun(db, sql, params = []) {
  return db.prepare(sql).run(Array.isArray(params) ? params : [params]);
}

function workOrderMultiplier(workOrder) {
  return Math.max(Number(workOrder.quantity_planned || workOrder.quantity || 1), 1);
}

function loadWorkOrder(db, workOrderId) {
  const workOrder = dbGet(db, "SELECT * FROM work_orders WHERE id = ?", workOrderId);
  if (!workOrder) throw ApiError.notFound("工单不存在");
  return workOrder;
}

module.exports = {
  EPSILON,
  DEFAULT_LOCATION,
  roundQty,
  dbAll,
  dbGet,
  dbRun,
  workOrderMultiplier,
  loadWorkOrder,
};
