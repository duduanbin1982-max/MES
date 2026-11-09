"use strict";
// services/cost/units.js
// 成本口径：key_components.unit_price / key_component_prices.actual_price 的单位是「万元/件」
// （见 db/migrations/014_key_component_unit_price.sql）；material / 台账金额单位是「元」。
const KEY_COMPONENT_PRICE_UNIT = "wan";
const KEY_COMPONENT_PRICE_MULTIPLIER = 10000;

function yuanFromWan(value) {
  const n = Number(value || 0);
  return Math.round(n * KEY_COMPONENT_PRICE_MULTIPLIER * 100) / 100;
}

module.exports = { KEY_COMPONENT_PRICE_UNIT, KEY_COMPONENT_PRICE_MULTIPLIER, yuanFromWan };
