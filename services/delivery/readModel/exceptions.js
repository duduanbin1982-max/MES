"use strict";

const { exceptionSummary, finalizeExceptions, instanceMap, pushException, today } = require("./exceptions/core");
const { collectOperationalExceptions } = require("./exceptions/operational");
const { collectQualityExceptions } = require("./exceptions/quality");
const { collectShortageExceptions } = require("./exceptions/shortages");
const { collectSupplyExceptions } = require("./exceptions/supply");

function createExceptionReadModel(ctx, helpers) {
  function collectExceptions() {
    const instances = helpers.getInstances();
    const shared = {
      ctx,
      helpers,
      items: [],
      instanceById: instanceMap(instances),
      now: today(),
      pushException,
    };

    collectOperationalExceptions(shared);
    collectShortageExceptions(shared);
    collectQualityExceptions(shared);
    collectSupplyExceptions(shared);

    return finalizeExceptions(ctx, helpers, shared.items);
  }

  return { collectExceptions, exceptionSummary };
}

module.exports = { createExceptionReadModel };
