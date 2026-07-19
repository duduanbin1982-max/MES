function createEquipmentOverview({ db, ApiError, lifecycle }) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);

  function countOrZero(sql, params = []) {
    try { return get(sql, params)?.c || 0; } catch (_error) { return 0; }
  }

  function sumOrZero(sql, params = []) {
    try { return get(sql, params)?.v || 0; } catch (_error) { return 0; }
  }

  return function buildOverview(id) {
    const inst = get("SELECT ei.*, em.model_code, em.model_name, em.diameter_mm, et.name_zh as type_name FROM equipment_instances ei LEFT JOIN equipment_models em ON ei.equipment_model_id = em.id LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE ei.id = ?", id);
    if (!inst) throw ApiError.notFound("项目装备不存在");
    const wo = get("SELECT count(*) total, sum(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending, sum(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) in_progress, sum(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed, sum(CASE WHEN status IN ('issue','rework') THEN 1 ELSE 0 END) issue FROM work_orders WHERE equipment_instance_id = ?", id) || {};
    const qc = get("SELECT count(*) total, sum(CASE WHEN result='pass' THEN 1 ELSE 0 END) passed, sum(CASE WHEN result!='pass' THEN 1 ELSE 0 END) failed FROM qc_inspections WHERE equipment_instance_id = ?", id) || {};
    const shortages = get("SELECT count(*) total, sum(CASE WHEN status IN ('open','following') THEN 1 ELSE 0 END) open FROM shortage_cases WHERE equipment_instance_id = ?", id) || {};
    const ncr = get("SELECT count(*) total, sum(CASE WHEN closed_at IS NULL THEN 1 ELSE 0 END) open FROM ncr_reports WHERE equipment_instance_id = ?", id) || {};
    const purchase = get("SELECT count(*) total, sum(CASE WHEN status NOT IN ('closed','completed','cancelled') THEN 1 ELSE 0 END) open FROM purchase_orders WHERE equipment_instance_id = ?", id) || {};
    const milestones = all("SELECT * FROM equipment_instance_milestones WHERE project_id = ? ORDER BY sequence, id", id);
    const lifecycleLogs = all("SELECT * FROM equipment_instance_lifecycle_logs WHERE equipment_instance_id = ? ORDER BY id DESC LIMIT 20", id);
    const materialCost = sumOrZero("SELECT SUM(COALESCE(unit_price,0) * COALESCE(quantity,0)) v FROM instance_bom WHERE equipment_instance_id = ?", [id]);
    const ledgerCost = sumOrZero("SELECT SUM(COALESCE(debit_amount,0) - COALESCE(credit_amount,0)) v FROM erp_cost_ledger WHERE equipment_instance_id = ?", [id]);
    const risks = [];
    if ((shortages.open || 0) > 0) risks.push({ type: "shortage", level: "high", title: `缺料未闭环 ${shortages.open} 项` });
    if ((ncr.open || 0) > 0) risks.push({ type: "quality", level: "high", title: `NCR 未闭环 ${ncr.open} 项` });
    if ((wo.issue || 0) > 0) risks.push({ type: "work_order", level: "medium", title: `异常/返工工单 ${wo.issue} 项` });
    if ((purchase.open || 0) > 0) risks.push({ type: "purchase", level: "medium", title: `采购未关闭 ${purchase.open} 单` });
    if (inst.planned_end && !["delivered", "operation", "archived"].includes(inst.lifecycle_stage) && new Date(inst.planned_end) < new Date()) {
      risks.push({ type: "schedule", level: "high", title: "计划交付日期已逾期" });
    }
    return {
      instance: inst,
      lifecycle,
      lifecycle_logs: lifecycleLogs,
      milestones,
      cards: {
        bom: { total: countOrZero("SELECT COUNT(*) c FROM instance_bom WHERE equipment_instance_id = ?", [id]), key_components: countOrZero("SELECT COUNT(*) c FROM instance_bom WHERE equipment_instance_id = ? AND COALESCE(is_key_component,0)=1", [id]) },
        documents: { total: countOrZero("SELECT COUNT(*) c FROM documents WHERE equipment_instance_id = ?", [id]), folders: countOrZero("SELECT COUNT(*) c FROM document_folders WHERE equipment_instance_id = ?", [id]) },
        purchase,
        kit: shortages,
        work_orders: wo,
        quality: { inspections: qc, ncr },
        cost: { material_estimate: materialCost, ledger_cost: ledgerCost, total: materialCost + ledgerCost },
        risks: { total: risks.length, items: risks },
      },
      freeze: {
        archive_status: inst.archive_status || "active",
        frozen_at: inst.frozen_at,
        archived_at: inst.archived_at,
        snapshot: inst.freeze_snapshot ? JSON.parse(inst.freeze_snapshot) : null,
      },
    };
  };
}

module.exports = {
  createEquipmentOverview,
};
