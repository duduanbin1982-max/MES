"use strict";
// services/cost/fx.js
// 成本台账多币种折算。汇率表 cost_fx_rates(currency, rate_to_cny)，CNY=1。
// 找不到币种时返回 1 并在结果中标记 unknown，避免静默把外币当人民币。
function getRate(db, currency) {
  const code = String(currency || "CNY").trim().toUpperCase() || "CNY";
  if (code === "CNY") return { currency: code, rate: 1, known: true };
  try {
    const row = db.prepare("SELECT rate_to_cny FROM cost_fx_rates WHERE currency = ?").get(code);
    if (row && Number(row.rate_to_cny) > 0) return { currency: code, rate: Number(row.rate_to_cny), known: true };
  } catch (_error) { /* 老库无表 */ }
  return { currency: code, rate: 1, known: false };
}

function convertToCny(db, amount, currency) {
  const rate = getRate(db, currency);
  const value = Number(amount || 0);
  return {
    amount_cny: Math.round(value * rate.rate * 100) / 100,
    currency: rate.currency,
    rate_to_cny: rate.rate,
    rate_known: rate.known,
  };
}

module.exports = { getRate, convertToCny };
