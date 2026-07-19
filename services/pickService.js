"use strict";

const { buildPickList, getReturnableLots, remainingForMaterial } = require("./pick/demand");
const { registerPickRoutes } = require("./pick/routes");
const { executePick, executeReturn, returnableQtyByLot } = require("./pick/transactions");

function register(app, db) {
  registerPickRoutes(app, db);
}

module.exports = {
  register,
  buildPickList,
  executePick,
  executeReturn,
  getReturnableLots,
  remainingForMaterial,
  returnableQtyByLot,
};
