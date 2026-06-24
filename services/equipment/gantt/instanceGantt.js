"use strict";
// services/equipment/gantt/instanceGantt.js
// GET /api/equipment_instances/:id/gantt
// 单台盾构机的甘特图: 按工时/资源排布的工序条
// Author: 三狗子 | Date: 2026-06-24

const { all, get, run, wrap } = require("./_helpers");
function getInstanceGantt(req, res, db) {
  const instanceId = req.params.id;
  const inst = get(db, 'SELECT * FROM equipment_instances WHERE id = ?', instanceId);
  if (!inst) return res.status(404).json({ error: 'instance not found' });

  const projectStart = inst.planned_start || inst.start_date || new Date().toISOString().slice(0, 10);

  // 取所有 process_nodes 和 deps
  const nodes = all(db, 'SELECT id, operation_name, status, bom_node_id, estimated_hours FROM process_nodes WHERE equipment_instance_id = ?', instanceId);
  const deps = all(db, 'SELECT predecessor_id, successor_id FROM process_dependencies WHERE equipment_instance_id = ?', instanceId);
  if (!nodes.length) return res.json({ project_start: projectStart, total_days: 0, bars: [] });

  // 计算每个节点有效时长
  const nodeTimes = {};
  for (const n of nodes) {
    let h = n.estimated_hours || 0;
    if (n.bom_node_id) {
      const bom = get(db, 'SELECT material_id FROM instance_bom WHERE id = ?', n.bom_node_id);
      if (bom && bom.material_id) {
        const kc = get(db, 'SELECT MAX(lead_time_weeks) as lt FROM key_components WHERE material_id = ?', bom.material_id);
        if (kc && kc.lt) {
          const lh = kc.lt * 40;
          if (lh > h) h = lh;
        }
      }
    }
    nodeTimes[n.id] = h;
  }

  // 拓扑排序 + 计算 ES (最早开始, 小时)
  const succMap = {};
  deps.forEach((d) => {
    if (!succMap[d.predecessor_id]) succMap[d.predecessor_id] = [];
    succMap[d.predecessor_id].push(d.successor_id);
  });

  const es = {}, ef = {};
  function calcES(id) {
    if (es[id] !== undefined) return es[id];
    const node = nodes.find((n) => n.id === id);
    if (!node) return 0;
    const preds = deps.filter((d) => d.successor_id === id);
    let max = 0;
    for (const p of preds) {
      const pEF = calcES(p.predecessor_id) + (nodeTimes[p.predecessor_id] || 0);
      if (pEF > max) max = pEF;
    }
    es[id] = max;
    ef[id] = max + (nodeTimes[id] || 0);
    return es[id];
  }
  nodes.forEach((n) => calcES(n.id));

  const projectHours = Math.max(...Object.values(ef));
  const hoursPerDay = 8;

  // 按 subsystem 聚合 (因为 L1 是 root)
  // 简化: 用 bom_node 的 subsystem 推断
  const bomToSubsystem = {};
  const subs = all(db, 'SELECT id, code, name_zh FROM equipment_subsystems');
  // 用 bom 关联的零件名做简单匹配
  const subsystemBars = [];
  const subsByName = {};
  subs.forEach((s) => { subsByName[s.code] = s; subsByName[s.name_zh] = s; });

  // 取每个节点的 subsystem (从 bom 关联)
  const nodeToSubsystem = {};
  for (const n of nodes) {
    if (!n.bom_node_id) { nodeToSubsystem[n.id] = '总装'; continue; }
    const bom = get(db, 'SELECT b.parent_id, b.material_id, b.notes FROM instance_bom b WHERE b.id = ?', n.bom_node_id);
    if (!bom) continue;
    // 简单按层: level 2+ 都是 subsystem 下属
    const level = get(db, 'SELECT level FROM instance_bom WHERE id = ?', n.bom_node_id)?.level;
    nodeToSubsystem[n.id] = level === 2 ? 'subsystem' : (bom.notes || 'part');
  }

  // 生成甘特条: 按状态分组
  const bars = nodes.map((n) => {
    const startH = es[n.id] || 0;
    const durH = nodeTimes[n.id] || 0;
    const startDate = new Date(projectStart);
    startDate.setHours(startDate.getHours() + startH);
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + durH);
    return {
      id: n.id,
      name: n.operation_name,
      subsystem: nodeToSubsystem[n.id] || '总装',
      start: startDate.toISOString().slice(0, 10),
      end: endDate.toISOString().slice(0, 10),
      duration_days: Math.ceil(durH / hoursPerDay),
      duration_hours: durH,
      status: n.status,
      progress: n.status === 'completed' ? 100 : (n.status === 'in_progress' ? 50 : 0),
      bom_node_id: n.bom_node_id
    };
  });

  res.json({
    instance: { id: inst.id, code: inst.instance_code, name: inst.instance_name },
    project_start: projectStart,
    total_hours: Math.round(projectHours * 10) / 10,
    total_days: Math.round(projectHours / hoursPerDay * 10) / 10,
    total_weeks: Math.round(projectHours / (hoursPerDay * 5) * 10) / 10,
    bars: bars.sort((a, b) => a.start.localeCompare(b.start))
  });
}

module.exports = { getInstanceGantt };
