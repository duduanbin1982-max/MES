"use strict";
// services/trace/chain.js
// P0-2（2026-10-18）：追溯五级链路统一接口。
//
//   GET /api/trace/chain?serial_no= | lot_no= | instance_code= | instance_id= | wo_code=
//   GET /api/trace/chain/coverage            （全厂链路填充率，供巡检/看板）
//
// 五级定义（对应 ISA-95 之外的业务链路，非标准层级，但和现场审核口径一致）：
//   L1 项目装备 equipment_instances
//   L2 工单     work_orders
//   L3 工序     work_order_operations + process_nodes
//   L4 批次/序列号 material_lots / serial_numbers（含 instance_bom 的实装批次）
//   L5 证据     检验（qc_inspections / work_order_qc）、焊缝+NDT、装配记录、文档
//
// 每级给 status：ok（有数据）/ partial（结构在但无数据）/ missing（锚点未找到）
// 并输出 gaps（具体断点与补录建议），供"3 次点击看到完整证据链"的验收使用。

const { wrap } = require("../../middleware/asyncHandler");
const { ApiError } = require("../../app/errors");

const LEVELS = [
  { level: 1, key: "instance", label: "项目装备" },
  { level: 2, key: "work_order", label: "工单" },
  { level: 3, key: "operation", label: "工序" },
  { level: 4, key: "lot_serial", label: "批次/序列号" },
  { level: 5, key: "evidence", label: "检验与证据" },
];

function makeQueries(db) {
  return {
    all: (sql, params = []) => db.prepare(sql).all(params),
    get: (sql, params = []) => db.prepare(sql).get(params),
  };
}

/** 解析锚点：支持 序列号 / 批次号 / 装备编码 / 装备 id / 工单号 */
function resolveAnchor(q, req) {
  const { serial_no, lot_no, instance_code, instance_id, wo_code } = req.query;

  if (serial_no) {
    const serial = q.get("SELECT * FROM serial_numbers WHERE serial_no = ?", [String(serial_no).trim()]);
    if (!serial) return { found: false, reason: "serial_not_found", query: { serial_no } };
    const instance = serial.equipment_instance_id
      ? q.get("SELECT * FROM equipment_instances WHERE id = ?", [serial.equipment_instance_id])
      : null;
    const lot = serial.lot_id ? q.get("SELECT * FROM material_lots WHERE id = ?", [serial.lot_id]) : null;
    return { found: true, kind: "serial", query: { serial_no }, serial, lot, instance, workOrderId: serial.work_order_id || null };
  }

  if (lot_no) {
    const lot = q.get("SELECT * FROM material_lots WHERE lot_no = ?", [String(lot_no).trim()]);
    if (!lot) return { found: false, reason: "lot_not_found", query: { lot_no } };
    // 由批次反查：领料/调拨记录 → 工单 → 设备
    const movement = q.get(
      `SELECT mm.*, wo.equipment_instance_id FROM material_movements mm
       LEFT JOIN work_orders wo ON wo.id = mm.work_order_id
       WHERE mm.material_lot_id = ? ORDER BY mm.id DESC LIMIT 1`,
      [lot.id]
    );
    const instance = movement && movement.equipment_instance_id
      ? q.get("SELECT * FROM equipment_instances WHERE id = ?", [movement.equipment_instance_id])
      : null;
    return { found: true, kind: "lot", query: { lot_no }, lot, instance, workOrderId: movement ? movement.work_order_id : null };
  }

  if (instance_code || instance_id) {
    const instance = instance_id
      ? q.get("SELECT * FROM equipment_instances WHERE id = ?", [Number(instance_id)])
      : q.get("SELECT * FROM equipment_instances WHERE instance_code = ?", [String(instance_code).trim()]);
    if (!instance) return { found: false, reason: "instance_not_found", query: { instance_code, instance_id } };
    return { found: true, kind: "instance", query: { instance_code, instance_id }, instance, workOrderId: null };
  }

  if (wo_code) {
    const wo = q.get("SELECT * FROM work_orders WHERE wo_code = ?", [String(wo_code).trim()]);
    if (!wo) return { found: false, reason: "work_order_not_found", query: { wo_code } };
    const instance = q.get("SELECT * FROM equipment_instances WHERE id = ?", [wo.equipment_instance_id]);
    return { found: true, kind: "work_order", query: { wo_code }, instance, workOrderId: wo.id };
  }

  throw ApiError.validation("serial_no / lot_no / instance_code / instance_id / wo_code 至少提供一个");
}

function buildChain(db, anchor) {
  const { all } = makeQueries(db);
  const instance = anchor.instance || null;
  const anchorWoId = anchor.workOrderId || null;

  // ---- L2 工单
  let workOrders = [];
  if (anchor.kind === "work_order") {
    workOrders = all("SELECT * FROM work_orders WHERE id = ?", [anchorWoId]);
  } else if (instance) {
    workOrders = all("SELECT * FROM work_orders WHERE equipment_instance_id = ? ORDER BY id", [instance.id]);
  }
  const woIds = workOrders.map((w) => w.id);
  const placeholders = woIds.length ? woIds.map(() => "?").join(",") : null;

  // ---- L3 工序：工单执行记录 + 工艺节点
  const operations = placeholders
    ? all(`SELECT wop.*, u.full_name AS operator_name FROM work_order_operations wop
           LEFT JOIN users u ON u.id = wop.operator_id
           WHERE wop.work_order_id IN (${placeholders}) ORDER BY wop.timestamp`, woIds)
    : [];
  const processNodes = instance
    ? all("SELECT id, operation_name, phase_code, status, sequence FROM process_nodes WHERE equipment_instance_id = ? ORDER BY sequence, id", [instance.id])
    : [];

  // ---- L4 批次/序列号
  const serials = (() => {
    if (anchor.serial) return [anchor.serial];
    if (instance) return all("SELECT * FROM serial_numbers WHERE equipment_instance_id = ? ORDER BY id", [instance.id]);
    return [];
  })();
  const lots = (() => {
    if (anchor.lot) return [anchor.lot];
    const byMovement = placeholders
      ? all(`SELECT DISTINCT ml.*, m.material_code, m.material_name FROM material_movements mm
             JOIN material_lots ml ON ml.id = mm.material_lot_id
             JOIN materials m ON m.id = ml.material_id
             WHERE mm.work_order_id IN (${placeholders})`, woIds)
      : [];
    const bySerial = serials.filter((s) => s.lot_id).map((s) => all("SELECT * FROM material_lots WHERE id = ?", [s.lot_id])[0]).filter(Boolean);
    const byBom = instance
      ? all(`SELECT DISTINCT ml.*, m.material_code, m.material_name FROM instance_bom ib
             JOIN material_lots ml ON ml.id = ib.material_lot_id
             JOIN materials m ON m.id = ml.material_id
             WHERE ib.equipment_instance_id = ?`, [instance.id])
      : [];
    const seen = new Map();
    for (const lot of [...byMovement, ...bySerial, ...byBom]) if (lot && !seen.has(lot.id)) seen.set(lot.id, lot);
    return [...seen.values()];
  })();
  const bomRows = instance
    ? all(`SELECT ib.id, ib.material_id, m.material_code, m.material_name, ib.quantity, ib.is_key_component,
                  ib.material_lot_id, ib.serial_id
           FROM instance_bom ib LEFT JOIN materials m ON m.id = ib.material_id
           WHERE ib.equipment_instance_id = ? ORDER BY ib.id`, [instance.id])
    : [];

  // ---- L5 证据
  const qc = (() => {
    if (instance) return all("SELECT * FROM qc_inspections WHERE equipment_instance_id = ? ORDER BY inspection_date DESC, id DESC", [instance.id]);
    return [];
  })();
  const woQc = placeholders
    ? all(`SELECT * FROM work_order_qc WHERE work_order_id IN (${placeholders})`, woIds)
    : [];
  const welds = placeholders
    ? all(`SELECT wr.*, u.full_name AS welder_name FROM weld_records wr
           LEFT JOIN users u ON u.id = wr.welder_id
           WHERE wr.work_order_id IN (${placeholders}) ORDER BY wr.id`, woIds)
    : (instance ? all("SELECT * FROM weld_records WHERE equipment_instance_id = ? ORDER BY id", [instance.id]) : []);
  const weldIds = welds.map((w) => w.id);
  const ndt = weldIds.length
    ? all(`SELECT * FROM ndt_records WHERE weld_record_id IN (${weldIds.map(() => "?").join(",")}) ORDER BY id`, weldIds)
    : [];
  const assemblies = placeholders
    ? all(`SELECT * FROM assembly_records WHERE work_order_id IN (${placeholders}) ORDER BY step_no`, woIds)
    : (instance ? all("SELECT * FROM assembly_records WHERE equipment_instance_id = ? ORDER BY step_no", [instance.id]) : []);
  const documents = (() => {
    const byInstance = instance
      ? all("SELECT id, doc_type, doc_no, title, status, version, equipment_instance_id, work_order_id FROM documents WHERE equipment_instance_id = ? ORDER BY id", [instance.id])
      : [];
    const byWo = placeholders
      ? all(`SELECT id, doc_type, doc_no, title, status, version, equipment_instance_id, work_order_id FROM documents
             WHERE work_order_id IN (${placeholders}) ORDER BY id`, woIds)
      : [];
    const seen = new Map();
    for (const doc of [...byInstance, ...byWo]) if (!seen.has(doc.id)) seen.set(doc.id, doc);
    return [...seen.values()];
  })();

  const levelRows = {
    1: instance ? [instance] : [],
    2: workOrders,
    3: [...operations, ...processNodes],
    4: [...serials, ...lots, ...bomRows],
    5: [...qc, ...woQc, ...welds, ...ndt, ...assemblies, ...documents],
  };

  const levels = LEVELS.map((meta) => {
    const rows = levelRows[meta.level] || [];
    const status = rows.length > 0 ? "ok" : (instance || anchor.kind === "work_order" ? "partial" : "missing");
    return { ...meta, count: rows.length, status };
  });

  // ---- 断点与补录建议
  const gaps = [];
  if (!instance) gaps.push({ level: 1, issue: "锚点未关联到设备实例", action: "检查序列号/批次的 equipment_instance_id 或领料记录是否挂了工单" });
  if (instance && workOrders.length === 0) gaps.push({ level: 2, issue: "装备下没有工单", action: "在工单管理里为该装备建工单并派工" });
  if (workOrders.length > 0 && operations.length === 0) gaps.push({ level: 3, issue: "工单没有执行记录（派工/开工/报工）", action: "现场扫码报工后即可形成工序级证据" });
  if (serials.length === 0) gaps.push({ level: 4, issue: "没有序列号记录", action: "对关键件在「追溯登记」建档（serial_numbers）或补 instance_bom.serial_id" });
  if (bomRows.length > 0 && bomRows.filter((b) => b.material_lot_id || b.serial_id).length === 0) {
    gaps.push({ level: 4, issue: "BOM 行未关联实装批次/序列号", action: "补 instance_bom.material_lot_id，做到「设计 BOM ↔ 实装批次」可对账" });
  }
  if (qc.length === 0 && woQc.length === 0) gaps.push({ level: 5, issue: "没有检验记录", action: "补齐来料/过程/出厂检验（qc_inspections）" });
  if (welds.length === 0 && instance) gaps.push({ level: 5, issue: "没有焊缝记录", action: "焊接工序需登记 weld_records（含焊工、工艺、批号）" });
  if (ndt.length === 0 && welds.length > 0) gaps.push({ level: 5, issue: "焊缝没有 NDT 记录", action: "按工艺要求补 NDT（ndt_records）" });
  if (documents.length === 0) gaps.push({ level: 5, issue: "没有关联文档（图纸/作业指导书/证书）", action: "在文档模块上传并关联到装备或工单" });

  return {
    found: true,
    anchor_kind: anchor.kind,
    query: anchor.query,
    anchor: {
      instance: instance ? { id: instance.id, code: instance.instance_code, name: instance.instance_name } : null,
      work_order: anchorWoId ? { id: anchorWoId } : null,
      serial_no: anchor.serial ? anchor.serial.serial_no : null,
      lot_no: anchor.lot ? anchor.lot.lot_no : null,
    },
    levels,
    coverage: Object.fromEntries(levels.map((l) => [l.key, l.status])),
    chain: {
      instance: instance ? { id: instance.id, code: instance.instance_code, name: instance.instance_name, status: instance.status } : null,
      work_orders: workOrders.map((w) => ({ id: w.id, code: w.wo_code, title: w.title, status: w.status })),
      operations: operations.map((o) => ({ id: o.id, work_order_id: o.work_order_id, action: o.action, operator: o.operator_name, time: o.timestamp, hours: o.hours_worked })),
      process_nodes: processNodes.map((n) => ({ id: n.id, name: n.operation_name, phase: n.phase_code, status: n.status })),
      serials: serials.map((s) => ({ id: s.id, serial_no: s.serial_no, status: s.status, lot_id: s.lot_id, work_order_id: s.work_order_id || null })),
      lots: lots.map((l) => ({ id: l.id, lot_no: l.lot_no, material_code: l.material_code, material_name: l.material_name, supplier: l.supplier, heat_no: l.heat_no, certificate_no: l.certificate_no })),
      bom: bomRows,
      inspections: qc.map((i) => ({ id: i.id, type: i.inspection_type, result: i.result, date: i.inspection_date, work_order_id: i.work_order_id })),
      work_order_qc: woQc,
      welds: welds.map((w) => ({ id: w.id, weld_no: w.weld_no, welder: w.welder_name, result: w.inspection_result, lot_id: w.material_lot_id, equipment_instance_id: w.equipment_instance_id || null })),
      ndt: ndt,
      assemblies: assemblies,
      documents: documents,
    },
    evidence_count: {
      inspections: qc.length, work_order_qc: woQc.length, welds: welds.length, ndt: ndt.length,
      assemblies: assemblies.length, documents: documents.length,
    },
    gaps,
    gaps_count: gaps.length,
    note: "五级链路：装备 → 工单 → 工序 → 批次/序列号 → 检验与证据；status=ok 有数据 / partial 结构在但无数据 / missing 锚点未找到",
  };
}

function registerChainRoutes(app, db) {
  const { all, get } = makeQueries(db);

  app.get("/api/trace/chain", wrap((req, res) => {
    const anchor = resolveAnchor({ all, get }, req);
    if (!anchor.found) return res.json({ found: false, ...anchor });
    res.json(buildChain(db, anchor));
  }));

  // 全厂链路填充率（巡检/看板用）：每级有多少实体真正串起来了
  app.get("/api/trace/chain/coverage", wrap((_req, res) => {
    const count = (sql) => {
      try { return get(sql).c; } catch (_e) { return null; }
    };
    const instances = count("SELECT COUNT(*) c FROM equipment_instances");
    const withWo = count("SELECT COUNT(DISTINCT equipment_instance_id) c FROM work_orders");
    const withOps = count("SELECT COUNT(DISTINCT wo.equipment_instance_id) c FROM work_order_operations wop JOIN work_orders wo ON wo.id = wop.work_order_id");
    const withSerials = count("SELECT COUNT(DISTINCT equipment_instance_id) c FROM serial_numbers WHERE equipment_instance_id IS NOT NULL");
    const withLotInBom = count("SELECT COUNT(DISTINCT equipment_instance_id) c FROM instance_bom WHERE material_lot_id IS NOT NULL");
    const withQc = count("SELECT COUNT(DISTINCT equipment_instance_id) c FROM qc_inspections");
    const withWeld = count("SELECT COUNT(DISTINCT equipment_instance_id) c FROM weld_records WHERE equipment_instance_id IS NOT NULL");
    const withDoc = count("SELECT COUNT(DISTINCT equipment_instance_id) c FROM documents");
    const pct = (n) => (instances ? Math.round((Number(n) / Number(instances)) * 1000) / 10 : 0);
    const rows = [
      { level: 1, key: "instance", label: "项目装备", count: instances, pct: instances ? 100 : 0 },
      { level: 2, key: "work_order", label: "工单覆盖", count: withWo, pct: pct(withWo) },
      { level: 3, key: "operation", label: "工序执行覆盖", count: withOps, pct: pct(withOps) },
      { level: 4, key: "serial", label: "序列号覆盖", count: withSerials, pct: pct(withSerials) },
      { level: 4, key: "bom_lot", label: "BOM 实装批次覆盖", count: withLotInBom, pct: pct(withLotInBom) },
      { level: 5, key: "qc", label: "检验覆盖", count: withQc, pct: pct(withQc) },
      { level: 5, key: "weld", label: "焊缝覆盖", count: withWeld, pct: pct(withWeld) },
      { level: 5, key: "document", label: "文档覆盖", count: withDoc, pct: pct(withDoc) },
    ];
    res.json({ instances, levels: rows, note: "pct = 有该级证据的装备数 / 装备总数" });
  }));
}

module.exports = { registerChainRoutes, buildChain, resolveAnchor, LEVELS };
