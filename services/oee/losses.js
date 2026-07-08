"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { pastDate, round2 } = require("./helpers");

const LOSS_CATEGORY_MAPPING = {
  "故障停机": "equipment_failure",
  "换型调试": "setup_adjustment",
  "空转待料": "idling_waiting",
  "短暂停机": "minor_stops",
  "速度损失": "speed_loss",
  "质量废品": "quality_defects",
};

function registerLossRoutes(app, store) {
  const { all, get, run } = store;

  app.get("/api/oee/losses", wrap((req, res) => {
    const { instance_id, days } = req.query;
    const d = parseInt(days) || 30;
    const since = pastDate(d);

    let lossSql = "SELECT loss_category, COUNT(*) AS events, COALESCE(SUM(duration_minutes),0) AS total_min FROM oee_loss_events WHERE start_time >= ?";
    const lossParams = [since];
    if (instance_id) {
      lossSql += " AND equipment_instance_id = ?";
      lossParams.push(instance_id);
    }
    lossSql += " GROUP BY loss_category ORDER BY total_min DESC";
    const lossRows = all(lossSql, lossParams);

    let shiftSql = "SELECT COALESCE(SUM(planned_minutes),0) AS total_planned, COALESCE(SUM(operating_minutes),0) AS total_operating FROM oee_shift_log WHERE shift_date >= ?";
    const shiftParams = [since];
    if (instance_id) {
      shiftSql += " AND equipment_instance_id = ?";
      shiftParams.push(instance_id);
    }
    const shiftAgg = get(shiftSql, shiftParams) || { total_planned: 0, total_operating: 0 };

    let totalLossMin = 0;
    const losses = lossRows.map((row) => {
      totalLossMin += row.total_min;
      return {
        category: row.loss_category,
        events: row.events,
        minutes: round2(row.total_min),
        pct_of_planned: shiftAgg.total_planned > 0 ? round2((row.total_min / shiftAgg.total_planned) * 100) : 0,
      };
    });

    res.json({
      period: { days: d, since },
      planned_minutes: round2(shiftAgg.total_planned || 0),
      actual_minutes: round2(shiftAgg.total_operating || 0),
      total_loss_minutes: round2(totalLossMin),
      losses,
      loss_category_mapping: LOSS_CATEGORY_MAPPING,
    });
  }));

  app.post("/api/oee/loss-events", wrap((req, res) => {
    const { equipment_instance_id, loss_category, start_time, end_time, duration_minutes, description } = req.body;
    if (!equipment_instance_id || !loss_category) {
      throw ApiError.validation("equipment_instance_id and loss_category required");
    }
    const result = run(
      `INSERT INTO oee_loss_events (equipment_instance_id, loss_category, start_time, end_time, duration_minutes, description, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [equipment_instance_id, loss_category, start_time || null, end_time || null, duration_minutes || null, description || null, req.user ? req.user.sub : null]
    );
    res.json({ id: result.lastInsertRowid, equipment_instance_id, loss_category });
  }));

  app.get("/api/oee/loss-events", wrap((req, res) => {
    const { instance_id, from, to, limit, offset } = req.query;
    let sql = "SELECT * FROM oee_loss_events WHERE 1=1";
    const params = [];
    if (instance_id) { sql += " AND equipment_instance_id = ?"; params.push(instance_id); }
    if (from) { sql += " AND start_time >= ?"; params.push(from); }
    if (to) { sql += " AND start_time <= ?"; params.push(to); }
    sql += " ORDER BY start_time DESC";
    if (limit) { sql += " LIMIT ?"; params.push(parseInt(limit)); }
    if (offset) { sql += " OFFSET ?"; params.push(parseInt(offset)); }

    const rows = all(sql, params);
    const total = get(
      "SELECT COUNT(*) as c FROM oee_loss_events WHERE 1=1" +
      (instance_id ? " AND equipment_instance_id = ?" : "") +
      (from ? " AND start_time >= ?" : "") +
      (to ? " AND start_time <= ?" : ""),
      [instance_id, from, to].filter(Boolean)
    );
    res.json({ rows, total: total ? total.c : 0 });
  }));

  app.get("/api/oee/loss-pareto", wrap((req, res) => {
    const { instance_id, days } = req.query;
    if (!instance_id) throw ApiError.validation("instance_id required");
    const d = parseInt(days) || 30;
    const since = pastDate(d);
    const rows = all(
      `SELECT loss_category, COUNT(*) AS event_count, COALESCE(SUM(duration_minutes), 0) AS total_minutes
       FROM oee_loss_events
       WHERE equipment_instance_id = ? AND start_time >= ?
       GROUP BY loss_category
       ORDER BY total_minutes DESC`,
      [instance_id, since]
    );

    let totalMin = 0;
    for (const row of rows) totalMin += row.total_minutes;
    let cumulative = 0;
    const pareto = rows.map((row) => {
      const pct = totalMin > 0 ? round2((row.total_minutes / totalMin) * 100) : 0;
      cumulative += pct;
      return {
        category: row.loss_category,
        event_count: row.event_count,
        minutes: round2(row.total_minutes),
        pct,
        cumulative_pct: round2(cumulative),
      };
    });

    res.json({
      instance_id: parseInt(instance_id),
      period: { days: d, since },
      total_loss_minutes: round2(totalMin),
      pareto,
      pareto_note: "前 80% 累计损失即为优先改善项",
    });
  }));
}

module.exports = { registerLossRoutes };
