"use strict";
// services/equipment/gantt/instanceGantt/_scheduler.js
// 未排程节点的只读 fallback 排程：按依赖前任的结束时间推后继开始时间，
// 带环检测（visiting 集合）。(原 services/equipment/gantt/instanceGantt.js 第 55-115 行)

const { HOURS_PER_WORKDAY, parseDate, addHours, hoursBetween } = require("./_time");

function nodeWorkHours(node) {
  const estimated = Number(node.estimated_hours || 0);
  if (estimated > 0) return estimated;
  const plannedStart = parseDate(node.planned_start);
  const plannedEnd = parseDate(node.planned_end);
  if (plannedStart && plannedEnd && plannedEnd > plannedStart) return hoursBetween(plannedStart, plannedEnd);
  return HOURS_PER_WORKDAY;
}

function buildFallbackScheduler(nodes, deps, projectStart) {
  const byId = new Map(nodes.map((node) => [Number(node.id), node]));
  const predMap = new Map();
  for (const dep of deps) {
    const successorId = Number(dep.successor_id);
    if (!predMap.has(successorId)) predMap.set(successorId, []);
    predMap.get(successorId).push(Number(dep.predecessor_id));
  }

  const starts = new Map();
  const ends = new Map();
  const visiting = new Set();

  function calcStart(id) {
    if (starts.has(id)) return starts.get(id);
    const node = byId.get(Number(id));
    if (!node) return projectStart;

    const realStart = parseDate(node.planned_start);
    if (realStart) {
      starts.set(Number(id), realStart);
      return realStart;
    }

    if (visiting.has(Number(id))) return projectStart;
    visiting.add(Number(id));

    let start = projectStart;
    for (const predecessorId of predMap.get(Number(id)) || []) {
      const predEnd = calcEnd(predecessorId);
      if (predEnd > start) start = predEnd;
    }

    visiting.delete(Number(id));
    starts.set(Number(id), start);
    return start;
  }

  function calcEnd(id) {
    if (ends.has(Number(id))) return ends.get(Number(id));
    const node = byId.get(Number(id));
    if (!node) return projectStart;

    const realEnd = parseDate(node.planned_end);
    const start = calcStart(Number(id));
    const end = realEnd && realEnd > start ? realEnd : addHours(start, nodeWorkHours(node));
    ends.set(Number(id), end);
    return end;
  }

  return { calcStart, calcEnd };
}

module.exports = { nodeWorkHours, buildFallbackScheduler };
