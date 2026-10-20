"use strict";
// app/processHealth.js
// 2026-10-19：全流程健康检查（纯函数，可单测）。
//
// 目的：一眼看出「单项目从立项到成本」8 个环节里，哪些已经有数据、哪些是空的、下一步该补哪。
// 每个环节给 status：
//   ok      该环节的关键字段都有数据
//   partial 有部分数据，但流程走不下去（比如有 BOM 但没挂批次）
//   empty   关键数据为 0

const STAGES = [
  { key: "project", label: "项目与里程碑", page: "/instances", action: "补合同号/客户/里程碑计划" },
  { key: "design_bom", label: "设计与 BOM", page: "/bom", action: "补齐 BOM 物料行并挂实装批次" },
  { key: "process", label: "工艺树与排程", page: "/process-tree", action: "给工序补计划时间/工位/依赖" },
  { key: "execution", label: "派工与报工", page: "/work-orders", action: "派工到人/工位，并每天报工" },
  { key: "material", label: "齐套与领料", page: "/inventory", action: "登记批次/库存，领料并核对齐套" },
  { key: "quality", label: "检验与证据", page: "/quality", action: "补来料/过程/出厂检验与 NDT/装配记录" },
  { key: "documents", label: "文档与图纸", page: "/documents", action: "上传图纸/SOP 并关联装备或工单" },
  { key: "delivery_cost", label: "交付与成本", page: "/cost", action: "补交付验收记录与成本台账" },
];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pct(part, total) {
  if (!num(total)) return null;
  return Math.round((num(part) / num(total)) * 1000) / 10;
}

function metric(key, label, value, required = null) {
  return { key, label, value: num(value), required };
}

/** 单环节评估 */
function evaluateStage(key, metrics) {
  const m = Object.fromEntries((metrics || []).map((item) => [item.key, item]));
  const get = (k) => num(m[k] && m[k].value);
  const meta = STAGES.find((stage) => stage.key === key) || { key, label: key, page: "", action: "" };
  const base = { key: meta.key, label: meta.label, page: meta.page, action: meta.action, metrics: metrics || [] };
  const blockers = [];
  let status = "empty";

  if (key === "project") {
    const milestones = get("milestones");
    const hasContract = get("contract") > 0;
    status = milestones > 0 ? (hasContract ? "ok" : "partial") : "empty";
    if (!milestones) blockers.push("还没有里程碑计划");
    if (!hasContract) blockers.push("合同号/客户未填");
  } else if (key === "design_bom") {
    const bom = get("bom_rows");
    const withMaterial = get("bom_with_material");
    const withLot = get("bom_with_lot");
    const lotCoverage = pct(withLot, withMaterial);
    if (bom > 0 && withMaterial > 0 && (lotCoverage || 0) >= 80) status = "ok";
    else if (bom > 0) status = "partial";
    if (!bom) blockers.push("还没有 BOM 行");
    else if (!withMaterial) blockers.push("BOM 行都没有挂物料（只剩装配/工艺节点）");
    else if ((lotCoverage || 0) < 80) blockers.push(`只有 ${lotCoverage}% 的物料行挂了实装批次（量差/追溯会缺）`);
  } else if (key === "process") {
    const nodes = get("nodes");
    const scheduled = get("nodes_scheduled");
    const withWs = get("nodes_with_workstation");
    const ratio = pct(scheduled, nodes);
    if (nodes > 0 && withWs >= nodes && (ratio || 0) >= 80) status = "ok";
    else if (nodes > 0) status = "partial";
    if (!nodes) blockers.push("工艺树还没有工序节点");
    else if (withWs < nodes) blockers.push(`${nodes - withWs} 个工序没指定工位`);
    if (nodes > 0 && (ratio || 0) < 80) blockers.push(`仅 ${ratio}% 工序有计划时间（排程/负荷会失真）`);
  } else if (key === "execution") {
    const wos = get("work_orders");
    const dispatched = get("work_orders_with_workstation");
    const reported = get("operations_with_hours");
    // 只要求"有报工"太宽松：4 张工单只报 1 条也会判 ok。改为覆盖 ≥ 工单数才算 ok。
    if (wos > 0 && dispatched > 0 && reported >= wos) status = "ok";
    else if (wos > 0) status = "partial";
    if (!wos) blockers.push("还没有工单");
    else if (!dispatched) blockers.push("工单未指定工位");
    if (wos > 0 && reported < wos) blockers.push(`报工只覆盖 ${reported}/${wos} 张工单（OEE/效率差不可信）`);
  } else if (key === "material") {
    const issues = get("issue_movements");
    const serials = get("serials");
    const lots = get("lots");
    if (issues > 0 && serials > 0) status = "ok";
    else if (issues > 0 || lots > 0) status = "partial";
    if (!lots) blockers.push("还没有物料批次");
    if (!issues) blockers.push("还没有领料流水（齐套/量差无从计算）");
    if (!serials) blockers.push("还没有序列号（单件追溯只能到批次）");
  } else if (key === "quality") {
    const qc = get("inspections");
    const woQc = get("work_order_qc");
    const welds = get("welds");
    const ndt = get("ndt");
    const assembly = get("assembly");
    if (qc > 0 && (ndt > 0 || woQc > 0)) status = "ok";
    else if (qc > 0 || welds > 0) status = "partial";
    if (!qc) blockers.push("还没有检验记录");
    if (welds > 0 && !ndt) blockers.push("有焊缝但还没有 NDT 记录");
    if (!assembly) blockers.push("还没有装配过程记录");
  } else if (key === "documents") {
    const docs = get("documents");
    status = docs > 0 ? "ok" : "empty";
    if (!docs) blockers.push("还没有关联到该项目的文档（图纸/SOP/证书）");
  } else if (key === "delivery_cost") {
    const delivery = get("delivery_milestones");
    const cost = get("cost_entries");
    const costTypes = get("cost_types");
    if (delivery > 0 && costTypes >= 2) status = "ok";
    else if (delivery > 0 || cost > 0) status = "partial";
    if (!delivery) blockers.push("还没有交付/验收相关的里程碑");
    if (!cost) blockers.push("还没有成本台账（成本偏差无从计算）");
    else if (costTypes < 2) blockers.push(`成本台账只有 ${costTypes} 类（建议至少材料+人工/外协）`);
  }

  const progress = partialProgress(key, get, m);
  const score = status === "ok" ? 100 : status === "partial" ? Math.round((50 + Math.min(progress, 100) * 0.49) * 10) / 10 : 0;
  return { ...base, status, score, progress_pct: status === "partial" ? Math.round(progress) : status === "ok" ? 100 : 0, blockers };
}

/**
 * 部分完成时的完成度（0~100）。用来把"部分"这个粗档位细化成分数，
 * 否则补了数据但没跨过阈值时，健康分纹丝不动，看起来像没进展。
 */
function partialProgress(key, get, metricsByKey) {
  if (key === "design_bom") {
    return pct(get("bom_with_lot"), get("bom_with_material")) || 0;
  }
  if (key === "process") {
    return pct(get("nodes_scheduled"), get("nodes")) || 0;
  }
  if (key === "execution") {
    return pct(get("operations_with_hours"), get("work_orders")) || 0;
  }
  if (key === "material") {
    // 领料与序列号各占一半
    return ((get("issue_movements") > 0 ? 50 : 0) + (get("serials") > 0 ? 50 : 0));
  }
  if (key === "quality") {
    const parts = [get("inspections") > 0, get("ndt") > 0 || get("work_order_qc") > 0, get("assembly") > 0];
    return (parts.filter(Boolean).length / parts.length) * 100;
  }
  if (key === "project") {
    return get("contract") > 0 ? 100 : 0;
  }
  if (key === "delivery_cost") {
    const delivery = get("delivery_milestones") > 0 ? 1 : 0;
    const cost = Math.min(get("cost_types") / 2, 1);
    return ((delivery + cost) / 2) * 100;
  }
  return 0;
}

/** 汇总：总分 + 各状态计数 + 下一步动作（按环节顺序取未完成的前 3 个） */
function summarize(stages) {
  const list = stages || [];
  const counts = { ok: 0, partial: 0, empty: 0 };
  for (const stage of list) counts[stage.status] = (counts[stage.status] || 0) + 1;
  const score = list.length
    ? Math.round((list.reduce((sum, stage) => sum + num(stage.score), 0) / list.length) * 10) / 10
    : 0;
  const nextActions = list
    .filter((stage) => stage.status !== "ok")
    .slice(0, 3)
    .map((stage) => ({
      stage: stage.label,
      action: stage.action,
      page: stage.page,
      blockers: stage.blockers.slice(0, 2),
    }));
  return {
    score,
    grade: score >= 85 ? "healthy" : score >= 60 ? "partial" : "blocked",
    counts,
    next_actions: nextActions,
  };
}

module.exports = { STAGES, metric, evaluateStage, summarize, pct, partialProgress };
