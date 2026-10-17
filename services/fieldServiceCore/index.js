"use strict";

require("../../app/errors");

require("./_helpers");
const { createFieldServiceTicket, getFieldServiceTicket, listFieldServiceTickets, updateFieldServiceTicket } = require("./tickets");
const { adjustSparePartStock, createSparePart, deleteSparePart, getSparePart, listSparePartAlerts, listSpareParts, setSparePartStock, updateSparePart } = require("./spareParts");
const { completeMaintenancePlan, createMaintenancePlan, deleteMaintenancePlan, getMaintenancePlan, listMaintenancePlans, updateMaintenancePlan } = require("./maintenancePlans");
const { maintenancePlanStats } = require("./stats");

module.exports = {
  adjustSparePartStock,
  completeMaintenancePlan,
  createFieldServiceTicket,
  createMaintenancePlan,
  createSparePart,
  deleteMaintenancePlan,
  deleteSparePart,
  getFieldServiceTicket,
  getMaintenancePlan,
  getSparePart,
  listFieldServiceTickets,
  listMaintenancePlans,
  listSparePartAlerts,
  listSpareParts,
  maintenancePlanStats,
  setSparePartStock,
  updateFieldServiceTicket,
  updateMaintenancePlan,
  updateSparePart,
};
