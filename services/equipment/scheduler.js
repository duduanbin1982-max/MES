// services/scheduler.js
// P2-#A 自动排程器
// 输入: process_nodes (estimated_hours + 依赖关系 + required_workstation_id)
// 输出: 填 planned_start / planned_end
// 算法: 拓扑排序 + 关键路径 + 工位冲突解决
// Author: 三狗子 | Date: 2026-06-23

// 注册到 server.js 时，路由是 POST /api/equipment_instances/:id/schedule
// query: ?dryRun=1 预览不写；?start=YYYY-MM-DD 覆盖项目开始日

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);
  const wrap = (handler) => (req, res) => {
    try { handler(req, res); }
    catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  };

  // 把 ISO/YYYY-MM-DD 加 N 小时，返回 YYYY-MM-DD HH:MM:SS
  function addHours(isoOrDate, hours) {
    if (!hours) hours = 0;
    const d = new Date(isoOrDate);
    d.setTime(d.getTime() + hours * 3600 * 1000);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }

  // 取 max(a, b) (字符串日期可直接比较)
  function maxDate(a, b) {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }

  function scheduleInstance(req, res) {
    const instanceId = parseInt(req.params.id, 10);
    const dryRun = req.query.dryRun === '1';
    const startOverride = req.query.start; // YYYY-MM-DD

    // 1) 项目开始日
    const inst = get('SELECT * FROM equipment_instances WHERE id = ?', instanceId);
    if (!inst) return res.status(404).json({ error: 'instance not found' });
    const projectStart = startOverride || inst.planned_start || inst.start_date || new Date().toISOString().slice(0, 10);

    // 2) 拿所有 process_nodes + 依赖
    const nodes = all('SELECT * FROM process_nodes WHERE equipment_instance_id = ? ORDER BY sequence, id', instanceId);
    if (nodes.length === 0) return res.json({ count: 0, message: 'no nodes' });
    const deps = all('SELECT * FROM process_dependencies WHERE equipment_instance_id = ?', instanceId);

    // 3) 拓扑排序 (Kahn 算法 + 环检测)
    const inDeg = {};
    const succMap = {};
    for (const n of nodes) inDeg[n.id] = 0;
    for (const d of deps) {
      if (inDeg[d.successor_id] !== undefined) inDeg[d.successor_id]++;
      (succMap[d.predecessor_id] = succMap[d.predecessor_id] || []).push(d);
    }
    const queue = nodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
    const topo = [];
    while (queue.length) {
      const id = queue.shift();
      topo.push(id);
      for (const d of (succMap[id] || [])) {
        inDeg[d.successor_id]--;
        if (inDeg[d.successor_id] === 0) queue.push(d.successor_id);
      }
    }
    if (topo.length < nodes.length) {
      const cyclic = nodes.filter(n => !topo.includes(n.id)).map(n => n.id);
      return res.status(400).json({ error: 'cycle detected in dependencies', cyclic_node_ids: cyclic });
    }

    // 4) 按拓扑序排程
    const nodeSchedule = {}; // id -> { planned_start, planned_end, hours }
    const wsLastEnd = {};    // workstation_id -> ISO
    const errors = [];
    const byId = {};
    for (const n of nodes) byId[n.id] = n;

    for (const id of topo) {
      const node = byId[id];
      const hours = node.estimated_hours || 0;

      // 4a) 前驱约束
      let earliest = projectStart;
      const predDeps = (deps || []).filter(d => d.successor_id === id);
      for (const d of predDeps) {
        const p = nodeSchedule[d.predecessor_id];
        if (!p) { errors.push('Node ' + id + ': predecessor ' + d.predecessor_id + ' not scheduled'); continue; }
        const depType = d.dep_type || 'FS';
        let constraint;
        if (depType === 'FS') constraint = p.planned_end;       // Finish-to-Start
        else if (depType === 'SS') constraint = p.planned_start; // Start-to-Start
        else if (depType === 'FF') {                           // Finish-to-Finish: constrains end
          constraint = addHours(p.planned_end, -(hours));
        } else constraint = p.planned_end;
        const withLag = addHours(constraint, d.lag_hours || 0);
        earliest = maxDate(earliest, withLag);
      }

      // 4b) 工位冲突
      const wsId = node.required_workstation_id;
      if (wsId && wsLastEnd[wsId] && wsLastEnd[wsId] > earliest) {
        earliest = wsLastEnd[wsId];
      }

      // 4c) 写排程
      const start = earliest;
      const end = addHours(start, hours);
      nodeSchedule[id] = { planned_start: start, planned_end: end, hours, ws_id: wsId || null };
      if (wsId) wsLastEnd[wsId] = end;
    }

    // 5) 写回 DB（除非 dryRun）
    let writtenCount = 0;
    if (!dryRun && errors.length === 0) {
      const update = db.prepare('UPDATE process_nodes SET planned_start = ?, planned_end = ? WHERE id = ?');
      const tx = db.transaction((ids) => {
        for (const id of ids) {
          const s = nodeSchedule[id];
          update.run(s.planned_start, s.planned_end, id);
          writtenCount++;
        }
      });
      tx(Object.keys(nodeSchedule));
    }

    // 6) 排序结果（按时间）方便 Gantt 渲染
    const scheduleArr = Object.entries(nodeSchedule).map(([id, s]) => Object.assign({ id: parseInt(id) }, s, { operation_name: byId[id] && byId[id].operation_name }));
    scheduleArr.sort((a, b) => a.planned_start.localeCompare(b.planned_start));

    res.json({
      instance_id: instanceId,
      instance_code: inst.instance_code,
      project_start: projectStart,
      node_count: nodes.length,
      dep_count: deps.length,
      written_count: writtenCount,
      dry_run: !!dryRun,
      errors,
      sample: scheduleArr.slice(0, 5),
      full: dryRun ? scheduleArr : undefined
    });
  }

  app.post('/api/equipment_instances/:id/schedule', wrap(scheduleInstance));
  app.get('/api/equipment_instances/:id/schedule', wrap(scheduleInstance)); // GET 也允许（方便调试）
}

module.exports = { register };
