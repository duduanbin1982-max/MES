"use strict";
// shared/capacity.js
// 2026-11-05（OEE/资源平衡口径统一）：工位每日可用工时。
//
// 与 services/equipment/gantt/resourcesGantt/_items.js 的 workstationDailyCapacity 同一规则：
//   白班/夜班 8h、双班 16h、三班 24h，再乘 max_workers（并行人数），封顶 24h。
// 原先 OEE 用固定 24h/天，导致同一工位在 OEE 页与资源平衡页利用率差 3 倍。

function workstationDailyCapacity(workstation, baseHours = 8) {
  const base = Number(baseHours || process.env.WORKSTATION_SHIFT_HOURS || 8) || 8;
  const shift = String((workstation && workstation.shift) || "day").toLowerCase();
  const shiftHours = shift.includes("three") || shift.includes("三班")
    ? base * 3
    : shift.includes("two") || shift.includes("double") || shift.includes("双班")
      ? base * 2
      : base;
  const workers = Math.max(1, Number((workstation && workstation.max_workers) || 1) || 1);
  return Math.min(24, shiftHours * workers);
}

module.exports = { workstationDailyCapacity };
