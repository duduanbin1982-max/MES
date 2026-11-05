"use strict";
// services/equipment/gantt/instanceGantt/_scheduler.js
// 未排程节点的只读 fallback 排程：按依赖约束推后继开始时间，带环检测（visiting 集合）。
//
// 2026-11-05（审计 F-05 整改）：fallback 与正式排程 scheduler 使用同一套约束语义
//   FS：前驱结束；SS：前驱开始；FF：前驱结束 - 本节点工时；SF：前驱开始 - 本节点工时
//   且叠加 dep.lag_hours（小时）。
// 之前只按"前驱结束"推，导致「依赖维护」里设的 SS/FF/SF 与 lag 在这条只读链路上失效。

const { HOURS_PER_WORKDAY, parseDate, addHours, hoursBetween } = require("./_time");

function nodeWorkHours(node) {
  const estimated = Number(node.estimated_hours || 0);
  if (estimated > 0) return estimated;
  const plannedStart = parseDate(node.planned_start);
  const plannedEnd = parseDate(node.planned_end);
  if (plannedStart && plannedEnd && plannedEnd > plannedStart) return hoursBetween(plannedStart, plannedEnd);
  return HOURS_PER_WORKDAY;
}

function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  return parseDate(value);
}

/**
 * 某条依赖给出的"后继最早开始时间"（Date；无法计算返回 null）
 * @param predecessor { planned_start, planned_end }（Date 或字符串都行）
 * @param successorHours 后继工时（FF/SF 需要用它回推）
 * @param dep { dep_type, lag_hours }
 */
function constraintStart(predecessor, successorHours, dep) {
  const predStart = toDate(predecessor && predecessor.planned_start);
  const predEnd = toDate(predecessor && predecessor.planned_end);
  if (!predStart || !predEnd) return null;
  const depType = String((dep && dep.dep_type) || "FS").toUpperCase();
  let base;
  if (depType === "SS") base = predStart;
  else if (depType === "FF") base = addHours(predEnd, -successorHours);
  else if (depType === "SF") base = addHours(predStart, -successorHours);
  else base = predEnd;
  const lag = Number((dep && dep.lag_hours) || 0);
  return lag ? addHours(base, lag) : base;
}

function buildFallbackScheduler(nodes, deps, projectStart) {
  const byId = new Map(nodes.map((node) => [Number(node.id), node]));
  const predMap = new Map();
  for (const dep of deps) {
    const successorId = Number(dep.successor_id);
    if (!predMap.has(successorId)) predMap.set(successorId, []);
    predMap.get(successorId).push(dep);
  }

  const starts = new Map();
  const ends = new Map();
  const visiting = new Set();

  function calcStart(id) {
    const key = Number(id);
    if (starts.has(key)) return starts.get(key);
    const node = byId.get(key);
    if (!node) return projectStart;

    // 真实计划优先
    const realStart = parseDate(node.planned_start);
    if (realStart) {
      starts.set(key, realStart);
      return realStart;
    }

    // 环保护：正在计算的节点遇环时退回项目开始日
    if (visiting.has(key)) return projectStart;
    visiting.add(key);

    let start = projectStart;
    const successorHours = nodeWorkHours(node);
    for (const dep of predMap.get(key) || []) {
      const predecessorId = Number(dep.predecessor_id);
      const predecessorNode = byId.get(predecessorId);
      if (!predecessorNode) continue;
      const predStart = parseDate(predecessorNode.planned_start) || calcStart(predecessorId);
      const predEnd = parseDate(predecessorNode.planned_end) || calcEnd(predecessorId);
      const candidate = constraintStart({ planned_start: predStart, planned_end: predEnd }, successorHours, dep);
      if (candidate && candidate > start) start = candidate;
    }

    visiting.delete(key);
    starts.set(key, start);
    return start;
  }

  function calcEnd(id) {
    const key = Number(id);
    if (ends.has(key)) return ends.get(key);
    const node = byId.get(key);
    if (!node) return projectStart;

    const realEnd = parseDate(node.planned_end);
    const start = calcStart(key);
    const end = realEnd && realEnd > start ? realEnd : addHours(start, nodeWorkHours(node));
    ends.set(key, end);
    return end;
  }

  return { calcStart, calcEnd };
}

module.exports = { nodeWorkHours, buildFallbackScheduler, constraintStart };
