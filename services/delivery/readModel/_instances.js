"use strict";
// services/delivery/readModel/_instances.js
// 整机读取: 列表（列缺失自动兜底）/ 近 30 天 OEE / 合同金额口径换算。
// (原 services/delivery/readModel.js 第 51-107 行)

function makeInstanceReaders(ctx) {
  const { tableExists, columns, safeAll } = ctx;

  function getInstances() {
    if (!tableExists("equipment_instances")) return [];
    const c = columns("equipment_instances");
    const field = (name, fallback = "NULL") => c.has(name) ? name : `${fallback} AS ${name}`;
    return safeAll(`
      SELECT id,
             ${field("instance_code", "''")},
             ${field("instance_name", "''")},
             ${field("status", "''")},
             ${field("lifecycle_stage", "''")},
             ${field("progress_pct", "0")},
             ${field("customer_name", "''")},
             ${field("planned_end", "NULL")},
             ${field("contract_amount", "0")},
             ${field("contract_amount_unit", "''")},
             ${field("contract_no", "''")},
             ${field("project_no", "''")},
             ${field("serial_no", "''")}
      FROM equipment_instances
      ORDER BY id
    `);
  }

  function oeeForInstance(instanceId) {
    if (!tableExists("oee_shift_log")) return null;
    const rows = safeAll("SELECT * FROM oee_shift_log WHERE equipment_instance_id = ? AND shift_date >= date('now', '-30 day')", [instanceId]);
    if (!rows.length) return null;
    let planned = 0, operating = 0, output = 0, good = 0, idealTotal = 0, idealCount = 0;
    for (const r of rows) {
      planned += Number(r.planned_minutes || 0);
      operating += Number(r.operating_minutes || 0);
      output += Number(r.total_output || 0);
      good += Number(r.good_output || 0);
      if (r.ideal_cycle_time) { idealTotal += Number(r.ideal_cycle_time); idealCount += 1; }
    }
    const availability = planned > 0 ? operating / planned : 0;
    const ideal = idealCount > 0 ? idealTotal / idealCount : 0;
    const performance = operating > 0 && ideal > 0 ? output * ideal / operating : 0;
    const quality = output > 0 ? good / output : 0;
    return Math.round(availability * performance * quality * 1000) / 10;
  }

  function instanceBudgetAmount(instance) {
    const raw = Number(instance.contract_amount || 0);
    const unit = String(instance.contract_amount_unit || "").toLowerCase();
    if (unit === "wan" || unit === "万元") return raw * 10000;
    return raw;
  }

  return { getInstances, oeeForInstance, instanceBudgetAmount };
}

module.exports = { makeInstanceReaders };
