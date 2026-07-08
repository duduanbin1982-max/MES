"use strict";

function createExceptionReadModel(ctx, helpers) {
  const { db, tableExists, has, safeAll, enrichEscalation } = ctx;
  const { getInstances, purchaseFollowupPath, severityRank } = helpers;

  function today() {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
  }

  function instanceMap(instances) {
    return new Map(instances.map((i) => [Number(i.id), i]));
  }

  function pushException(list, item) {
    const severityMap = { danger: "high", error: "high", fatal: "critical", warn: "warning" };
    const severity = severityMap[item.severity] || item.severity || "info";
    list.push({
      id: item.id || `${item.type}_${list.length + 1}`,
      type: item.type,
      severity,
      title: item.title,
      message: item.message || item.title,
      instance_id: item.instance_id || null,
      instance_code: item.instance_code || null,
      source: item.source || item.type,
      source_path: item.source_path || null,
      owner: item.owner || null,
      due_at: item.due_at || null,
      created_at: item.created_at || null,
      action_label: item.action_label || "查看",
    });
  }

  function mergeCaseState(items) {
    if (!items.length) return items;
    const cases = safeAll(`SELECT * FROM exception_cases WHERE exception_id IN (${items.map(() => "?").join(",")})`, items.map((i) => i.id));
    const caseMap = new Map(cases.map((c) => [c.exception_id, c]));
    return items.map((item) => {
      const c = caseMap.get(item.id);
      if (!c) return { ...item, case_status: "open", owner_id: null, owner_name: null, priority: item.severity, action_count: 0 };
      return {
        ...item,
        case_status: c.status || "open",
        owner_id: c.owner_id,
        owner_name: c.owner_name,
        priority: c.priority || item.severity,
        due_at: c.due_at || item.due_at,
        closed_at: c.closed_at,
        close_note: c.close_note,
        last_action: c.last_action,
      };
    });
  }

  function collectExceptions() {
    const instances = getInstances();
    const im = instanceMap(instances);
    const items = [];
    const now = today();

    if (tableExists("work_orders") && has("work_orders", "planned_end")) {
      const rows = safeAll(`
        SELECT id, wo_code, title, status, planned_end, equipment_instance_id,
               julianday(?) - julianday(planned_end) AS overdue_days
        FROM work_orders
        WHERE planned_end IS NOT NULL
          AND planned_end < ?
          AND COALESCE(status, '') NOT IN ('completed', 'cancelled', 'closed')
        ORDER BY planned_end ASC
        LIMIT 100
      `, [now, now]);
      for (const r of rows) {
        const inst = im.get(Number(r.equipment_instance_id)) || {};
        const days = Math.max(0, Math.round(Number(r.overdue_days || 0) * 10) / 10);
        pushException(items, {
          id: `wo_overdue_${r.id}`,
          type: "delivery_delay",
          severity: days >= 7 ? "critical" : days >= 3 ? "high" : "warning",
          title: `工单延期 ${r.wo_code || r.id}`,
          message: `${inst.instance_code || "-"} ${r.title || "工单"} 已延期 ${days} 天`,
          instance_id: r.equipment_instance_id,
          instance_code: inst.instance_code,
          due_at: r.planned_end,
          source: "work_orders",
          source_path: "/work-orders",
          action_label: "处理工单",
        });
      }
    }

    if (tableExists("process_nodes") && has("process_nodes", "status")) {
      const blocked = safeAll(`
        SELECT id, operation_name, status, planned_end, equipment_instance_id
        FROM process_nodes
        WHERE status = 'blocked'
        LIMIT 100
      `);
      for (const r of blocked) {
        const inst = im.get(Number(r.equipment_instance_id)) || {};
        pushException(items, {
          id: `process_blocked_${r.id}`,
          type: "process_blocked",
          severity: "high",
          title: `工序卡滞 ${r.operation_name || r.id}`,
          message: `${inst.instance_code || "-"} 工艺节点处于 blocked 状态`,
          instance_id: r.equipment_instance_id,
          instance_code: inst.instance_code,
          due_at: r.planned_end,
          source: "process_nodes",
          source_path: "/process-tree",
          action_label: "查看工艺树",
        });
      }
    }

    if (tableExists("process_nodes") && has("process_nodes", "planned_end")) {
      const rows = safeAll(`
        SELECT id, operation_name, status, planned_end, equipment_instance_id,
               julianday(?) - julianday(planned_end) AS overdue_days
        FROM process_nodes
        WHERE planned_end IS NOT NULL
          AND planned_end < ?
          AND COALESCE(status, '') NOT IN ('completed', 'done')
        ORDER BY planned_end ASC
        LIMIT 100
      `, [now, now]);
      for (const r of rows) {
        const inst = im.get(Number(r.equipment_instance_id)) || {};
        const days = Math.max(0, Math.round(Number(r.overdue_days || 0) * 10) / 10);
        pushException(items, {
          id: `process_overdue_${r.id}`,
          type: "process_delay",
          severity: days >= 7 ? "critical" : days >= 3 ? "high" : "warning",
          title: `工序延期 ${r.operation_name || r.id}`,
          message: `${inst.instance_code || "-"} 工序计划已延期 ${days} 天`,
          instance_id: r.equipment_instance_id,
          instance_code: inst.instance_code,
          due_at: r.planned_end,
          source: "process_nodes",
          source_path: "/schedule",
          action_label: "查看排程",
        });
      }
    }

    if (tableExists("instance_eco") && has("instance_eco", "status")) {
      const rows = safeAll(`
        SELECT id, eco_no, title, status, equipment_instance_id, created_at
        FROM instance_eco
        WHERE COALESCE(status, '') IN ('open', 'pending', 'reviewing')
        ORDER BY id DESC
        LIMIT 100
      `);
      for (const r of rows) {
        const inst = im.get(Number(r.equipment_instance_id)) || {};
        pushException(items, {
          id: `eco_open_${r.id}`,
          type: "eco_pending",
          severity: "warning",
          title: `ECO 待处理 ${r.eco_no || r.id}`,
          message: `${inst.instance_code || "-"} ${r.title || "设计变更"} 等待评审或执行`,
          instance_id: r.equipment_instance_id,
          instance_code: inst.instance_code,
          created_at: r.created_at,
          source: "instance_eco",
          source_path: "/eco",
          action_label: "处理 ECO",
        });
      }
    }

    if (tableExists("andon_alerts")) {
      const statusColumn = has("andon_alerts", "status") ? "status" : null;
      const rows = safeAll(`
        SELECT * FROM andon_alerts
        ${statusColumn ? "WHERE COALESCE(status, '') NOT IN ('resolved', 'closed')" : ""}
        ORDER BY id DESC
        LIMIT 100
      `);
      for (const r of rows) {
        const instId = r.equipment_instance_id || r.instance_id || null;
        const inst = im.get(Number(instId)) || {};
        pushException(items, {
          id: `andon_${r.id}`,
          type: "andon",
          severity: r.severity || "high",
          title: r.title || r.message || `ANDON ${r.id}`,
          message: r.message || r.description || "现场异常未关闭",
          instance_id: instId,
          instance_code: inst.instance_code,
          created_at: r.created_at,
          source: "andon_alerts",
          source_path: "/andon",
          action_label: "响应安灯",
        });
      }
    }

    if (tableExists("shortage_cases")) {
      const rows = safeAll(`
        SELECT sc.*, m.material_code, m.material_name, wo.wo_code, wo.title AS wo_title, ei.instance_code
        FROM shortage_cases sc
        LEFT JOIN materials m ON m.id = sc.material_id
        LEFT JOIN work_orders wo ON wo.id = sc.work_order_id
        LEFT JOIN equipment_instances ei ON ei.id = sc.equipment_instance_id
        WHERE COALESCE(sc.status, '') NOT IN ('closed', 'resolved', 'arrived', 'received', 'cancelled')
        ORDER BY
          CASE sc.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
          sc.updated_at DESC
        LIMIT 200
      `);
      for (const r of rows) {
        const shortageQty = Math.round(Number(r.shortage_qty || 0) * 100) / 100;
        pushException(items, {
          id: `shortage_${r.id}`,
          type: "kit_shortage",
          severity: r.priority === "critical" ? "critical" : r.priority === "high" ? "high" : "warning",
          title: `缺料 ${r.material_code || r.material_id}`,
          message: `${r.instance_code || "-"} / ${r.wo_code || "工单"} 缺 ${r.material_name || "物料"} ${shortageQty}${r.unit || ""}，状态 ${r.status || "open"}${r.purchase_request_no ? ` / 采购申请 ${r.purchase_request_no}` : ""}${r.expected_date ? ` / ETA ${String(r.expected_date).slice(0, 10)}` : ""}${r.owner_name ? ` / 责任人 ${r.owner_name}` : ""}`,
          instance_id: r.equipment_instance_id,
          instance_code: r.instance_code,
          due_at: r.expected_date,
          created_at: r.created_at,
          source: "shortage_cases",
          source_path: (r.purchase_request_no || ["following", "purchasing"].includes(r.status || "")) ? purchaseFollowupPath(r.equipment_instance_id, r.purchase_request_no || null) : "/kit-closure",
          action_label: (r.purchase_request_no || ["following", "purchasing"].includes(r.status || "")) ? "采购跟催" : "处理缺料",
        });
      }
    }

    if (tableExists("qc_ncr")) {
      const rows = safeAll(`
        SELECT * FROM qc_ncr
        WHERE COALESCE(status, '') NOT IN ('closed', 'resolved')
        ORDER BY id DESC
        LIMIT 100
      `);
      for (const r of rows) {
        const instId = r.equipment_instance_id || r.instance_id || null;
        const inst = im.get(Number(instId)) || {};
        pushException(items, {
          id: `qc_ncr_${r.id}`,
          type: "quality_ncr",
          severity: r.severity || "high",
          title: r.ncr_no ? `NCR ${r.ncr_no}` : `质量不合格 ${r.id}`,
          message: r.title || r.description || "质量问题待处置",
          instance_id: instId,
          instance_code: inst.instance_code,
          created_at: r.created_at,
          source: "qc_ncr",
          source_path: "/quality",
          action_label: "处置 NCR",
        });
      }
    }

    if (tableExists("ncr_reports")) {
      const rows = safeAll(`
        SELECT n.*, ei.instance_code,
          CASE
            WHEN n.closed_at IS NOT NULL THEN 'closed'
            WHEN n.disposition IS NOT NULL AND n.disposition != 'pending' THEN 'disposed'
            ELSE 'open'
          END AS ncr_status,
          (
            SELECT COUNT(*) FROM capa_actions c
            WHERE c.ncr_id = n.id AND COALESCE(c.status, '') != 'closed'
          ) AS open_capa_count,
          (
            SELECT COUNT(*) FROM ncr_rechecks r
            WHERE r.ncr_id = n.id AND r.result = 'fail'
          ) AS failed_recheck_count
        FROM ncr_reports n
        LEFT JOIN equipment_instances ei ON ei.id = n.equipment_instance_id
        WHERE n.closed_at IS NULL
        ORDER BY
          CASE n.severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 ELSE 3 END,
          n.created_at DESC
        LIMIT 200
      `);
      for (const r of rows) {
        const severity = r.severity === "critical" ? "critical" : r.severity === "major" ? "high" : "warning";
        const step = r.ncr_status === "open"
          ? "待处置"
          : Number(r.open_capa_count || 0) > 0
            ? `CAPA未完成 ${r.open_capa_count}`
            : Number(r.failed_recheck_count || 0) > 0
              ? "复检失败"
              : "待复检/关闭";
        pushException(items, {
          id: `ncr_${r.id}`,
          type: "quality_ncr",
          severity,
          title: `NCR ${r.ncr_code || r.id}`,
          message: `${r.instance_code || "-"} ${r.part_name || "部件"}：${r.defect_desc || "质量问题"}（${step}）`,
          instance_id: r.equipment_instance_id,
          instance_code: r.instance_code,
          created_at: r.created_at,
          source: "ncr_reports",
          source_path: "/quality",
          action_label: "处理 NCR",
        });
      }
    }

    if (tableExists("inventory") && has("inventory", "available_qty") && has("inventory", "safety_stock")) {
      const rows = safeAll(`
        SELECT i.*, m.material_code, m.material_name
        FROM inventory i
        LEFT JOIN materials m ON m.id = i.material_id
        WHERE COALESCE(i.available_qty, 0) < COALESCE(i.safety_stock, 0)
        LIMIT 100
      `);
      for (const r of rows) {
        pushException(items, {
          id: `low_stock_${r.id || r.material_id}`,
          type: "low_stock",
          severity: "warning",
          title: `库存低于安全线 ${r.material_code || r.material_id}`,
          message: `${r.material_name || "物料"} 可用 ${r.available_qty || 0}，安全库存 ${r.safety_stock || 0}`,
          source: "inventory",
          source_path: "/materials?tab=inv",
          action_label: "查看库存",
        });
      }
    }

    if (tableExists("materials")) {
      // MDM issues are collected from the dedicated masterDataService rules below.
    }

    try {
      const mdm = require("../../masterDataService");
      if (mdm && typeof mdm.collectForException === "function") {
        for (const r of mdm.collectForException(db).issues.slice(0, 200)) {
          pushException(items, {
            id: `mdm_${r.id}`,
            type: `mdm_${r.domain}`,
            severity: r.severity,
            title: r.title,
            message: r.detail,
            source: r.source || "master_data",
            source_path: r.source_path || "/mdm",
            created_at: null,
            action_label: "治理主数据",
          });
        }
      }
    } catch (_e) {}

    if (tableExists("purchase_orders") && has("purchase_orders", "expected_date")) {
      const rows = safeAll(`
        SELECT *
        FROM purchase_orders
        WHERE expected_date IS NOT NULL
          AND expected_date < ?
          AND COALESCE(status, '') NOT IN ('received', 'closed', 'cancelled')
        ORDER BY expected_date ASC
        LIMIT 100
      `, [now]);
      for (const r of rows) {
        const instId = r.equipment_instance_id || r.instance_id || null;
        const inst = im.get(Number(instId)) || {};
        pushException(items, {
          id: `po_overdue_${r.id}`,
          type: "purchase_delay",
          severity: "high",
          title: `采购延期 ${r.po_no || r.id}`,
          message: `${r.supplier_name || "供应商"} 预计到货已超期`,
          instance_id: instId,
          instance_code: inst.instance_code,
          due_at: r.expected_date,
          source: "purchase_orders",
          source_path: "/purchase",
          action_label: "采购跟催",
        });
      }
    }

    const merged = enrichEscalation(mergeCaseState(items));
    merged.sort((a, b) => {
      const statusRank = (a.case_status === "closed" ? 0 : 1) - (b.case_status === "closed" ? 0 : 1);
      if (statusRank) return -statusRank;
      const bySeverity = severityRank(b.severity) - severityRank(a.severity);
      if (bySeverity) return bySeverity;
      return String(b.created_at || b.due_at || "").localeCompare(String(a.created_at || a.due_at || ""));
    });
    return merged;
  }

  function exceptionSummary(items) {
    const active = items.filter((item) => item.case_status !== "closed");
    const bySeverity = { critical: 0, high: 0, warning: 0, info: 0 };
    const byType = {};
    const byStatus = { open: 0, assigned: 0, processing: 0, closed: 0 };
    for (const item of items) {
      byStatus[item.case_status || "open"] = (byStatus[item.case_status || "open"] || 0) + 1;
    }
    for (const item of active) {
      bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1;
      byType[item.type] = (byType[item.type] || 0) + 1;
    }
    return { total: active.length, all_total: items.length, by_severity: bySeverity, by_type: byType, by_status: byStatus };
  }

  return {
    collectExceptions,
    exceptionSummary,
  };
}

module.exports = { createExceptionReadModel };
