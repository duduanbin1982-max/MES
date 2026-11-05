"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");

function register(app, db) {
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);

  app.get("/api/equipment_instances/:id/milestones", wrap((req, res) => {
    const rows = all("SELECT * FROM instance_milestones WHERE equipment_instance_id = ? ORDER BY sequence, id", req.params.id);
    res.json(rows);
  }));

  app.post("/api/equipment_instances/:id/milestones/auto-generate", wrap((req, res) => {
    const phases = [
      ["S1", "设计冻结", 1],
      ["S2", "采购", 2],
      ["S3", "自制件生产", 3],
      ["S4", "部件预装", 4],
      ["S5", "总装", 5],
      ["S6", "厂内调试", 6],
      ["S7", "拆解/包装/发运", 7],
      ["S8", "现场组装", 8],
      ["S9", "试掘进/验收", 9],
      ["S10", "质保期", 10],
    ];

    const existing = get("SELECT COUNT(*) AS c FROM instance_milestones WHERE equipment_instance_id = ?", req.params.id).c;
    if (existing > 0) return res.json({ count: existing, skipped: true });

    const insert = db.prepare(`
      INSERT INTO instance_milestones (equipment_instance_id, phase_code, phase_name, sequence, planned_start, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const [code, name, sequence] of phases) {
      insert.run(req.params.id, code, name, sequence, "2026-07-01", "pending");
    }
    res.json({ count: phases.length, skipped: false });
  }));

  // 2026-11-05（审计 F-09）：补齐里程碑计划日期。
  // 背景：auto-generate 只写了 planned_start=2026-07-01，planned_end 全空（生产 44 条里 28 条缺 planned_end），
  // 导致"里程碑延期"无从判定。这里按项目周期 + 阶段权重把缺失的计划起止补齐（只补不覆盖）。
  app.post("/api/equipment_instances/:id/milestones/backfill", wrap((req, res) => {
    const { formatSqlDate } = require("../../shared/datetime");
    const instanceId = Number.parseInt(req.params.id, 10);
    const dryRun = req.query.dryRun === "1" || req.body?.dry_run === true;
    const instance = get("SELECT * FROM equipment_instances WHERE id = ?", instanceId);
    if (!instance) throw ApiError.notFound("instance not found");
    const rows = all("SELECT * FROM instance_milestones WHERE equipment_instance_id = ? ORDER BY sequence, id", instanceId);
    if (!rows.length) return res.json({ instance_id: instanceId, updated: 0, message: "no milestones" });

    const parse = (value) => {
      if (!value) return null;
      const raw = String(value).trim();
      const normalized = raw.length === 10 ? `${raw}T00:00:00` : raw.replace(" ", "T");
      const date = new Date(normalized);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const nodeRange = get(`SELECT MIN(planned_start) AS min_start, MAX(planned_end) AS max_end
                             FROM process_nodes WHERE equipment_instance_id = ?`, instanceId);
    const projectStart = parse(instance.planned_start || instance.start_date)
      || parse(nodeRange?.min_start)
      || new Date();
    const projectEnd = parse(instance.planned_end)
      || parse(nodeRange?.max_end)
      || new Date(projectStart.getTime() + 240 * 86400000);
    const totalDays = Math.max(rows.length, Math.round((projectEnd.getTime() - projectStart.getTime()) / 86400000));

    // 阶段权重（设计/采购/自制/预装/总装/调试/发运/现场/验收/质保）
    const weights = { S1: 6, S2: 12, S3: 32, S4: 10, S5: 10, S6: 8, S7: 4, S8: 9, S9: 6, S10: 3 };
    const weightSum = rows.reduce((sum, row) => sum + (weights[row.phase_code] || 5), 0) || rows.length;
    // 规则（2026-11-05 定稿）：
    //   · 未完成（pending/active/delayed）的里程碑按阶段权重重新规划计划起止 ——
    //     生产数据里 auto-generate 把 10 个阶段全写成 planned_start=2026-07-01、planned_end 全空，
    //     只补 end 会得到一串互相重叠的假区间；
    //   · 已完成（completed）的保留原计划，只在其 planned_end 缺失时补一个不早于开始的结束日。
    const changes = [];
    let cursor = new Date(projectStart);
    for (const row of rows) {
      const weight = weights[row.phase_code] || 5;
      const spanDays = Math.max(1, Math.round((weight / weightSum) * totalDays));
      const segmentStart = new Date(cursor);
      cursor = new Date(cursor.getTime() + spanDays * 86400000);
      const segmentEnd = new Date(cursor.getTime() - 86400000);
      const completed = String(row.status) === "completed";
      const existingStart = parse(row.planned_start);
      const existingEnd = parse(row.planned_end);
      const nextStart = completed ? (existingStart || segmentStart) : segmentStart;
      let nextEnd = completed ? (existingEnd || segmentEnd) : segmentEnd;
      if (nextEnd.getTime() < nextStart.getTime()) nextEnd = nextStart;

      const nextStartText = formatSqlDate(nextStart);
      const nextEndText = formatSqlDate(nextEnd);
      if (nextStartText === (row.planned_start || null) && nextEndText === (row.planned_end || null)) continue;
      changes.push({
        id: row.id,
        phase_code: row.phase_code,
        phase_name: row.phase_name,
        status: row.status,
        old_planned_start: row.planned_start || null,
        old_planned_end: row.planned_end || null,
        new_planned_start: nextStartText,
        new_planned_end: nextEndText,
      });
    }

    let updated = 0;
    if (!dryRun && changes.length) {
      const tx = db.transaction(() => {
        for (const change of changes) {
          run("UPDATE instance_milestones SET planned_start = ?, planned_end = ? WHERE id = ?",
            change.new_planned_start, change.new_planned_end, change.id);
          updated += 1;
        }
      });
      tx();
    }

    res.json({
      instance_id: instanceId,
      dry_run: dryRun,
      project_start: formatSqlDate(projectStart),
      project_end: formatSqlDate(projectEnd),
      total: rows.length,
      changed_count: changes.length,
      updated,
      changes,
    });
  }));

  app.put("/api/milestones/:id", wrap((req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) throw ApiError.validation("milestone id is required");

    const row = get("SELECT * FROM instance_milestones WHERE id = ?", id);
    if (!row) throw ApiError.notFound("Milestone not found");

    const allowed = ["phase_name", "planned_start", "planned_end", "actual_start", "actual_end", "status", "notes"];
    const body = req.body || {};

    // 2026-11-05（审计 F-05）：里程碑状态流转校验 + 自动补实际时间（本地日期，避免 UTC 早 8 点记成昨天）
    const TRANSITIONS = {
      pending: ["active", "delayed"],
      delayed: ["active"],
      active: ["completed", "delayed"],
      completed: [],
    };
    const pad = (value) => String(value).padStart(2, "0");
    const todayLocal = () => {
      const value = new Date();
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    };
    if (body.status && body.status !== row.status) {
      const allowedNext = TRANSITIONS[String(row.status || "pending")] || [];
      if (!allowedNext.includes(body.status)) {
        throw ApiError.validation(`里程碑不能从「${row.status}」直接改为「${body.status}」`, { current: row.status, target: body.status, allowed: allowedNext });
      }
      if (body.status === "active" && !body.actual_start) body.actual_start = todayLocal();
      if (body.status === "completed" && !body.actual_end) body.actual_end = todayLocal();
    }

    const sets = [];
    const params = [];
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        sets.push(`${field} = ?`);
        params.push(body[field] || null);
      }
    }
    if (!sets.length) throw ApiError.validation("No editable fields supplied");

    params.push(id);
    run(`UPDATE instance_milestones SET ${sets.join(", ")} WHERE id = ?`, ...params);
    const updated = get("SELECT * FROM instance_milestones WHERE id = ?", id);
    res.json({ ok: true, milestone: updated });
  }));
}

module.exports = { register };
