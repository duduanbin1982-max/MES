"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { pastDate, round2 } = require("./helpers");
const { catalog, normalizeKey, labelOf, bucketOf, countsAsLoss } = require("../../app/oee/lossCatalog");

// 2026-10-18 P0-1：损失分类以 shared/oeeLossCatalog.json 为唯一来源（不再硬编码映射）
const LOSS_CATEGORY_MAPPING = Object.fromEntries(
  catalog.categories.map((c) => [c.key, c.key])
);
const LOSS_CATALOG = {
  version: catalog.version,
  categories: catalog.categories.map((c) => ({ key: c.key, label: c.label, bucket: c.bucket, counts_as_loss: c.countsAsLoss !== false })),
};

function registerLossRoutes(app, store) {
  const { all, get, run } = store;

  app.get("/api/oee/losses", wrap((req, res) => {
    const { instance_id, days } = req.query;
    const d = parseInt(days) || 30;
    const since = pastDate(d);

    let lossSql = "SELECT COALESCE(category_key, loss_category) AS loss_category, COUNT(*) AS events, COALESCE(SUM(duration_minutes),0) AS total_min FROM oee_loss_events WHERE start_time >= ?";
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

    // 规范化聚合：历史中文标签与规范 key 合并成同一类
    const merged = new Map();
    for (const row of lossRows) {
      const key = normalizeKey(row.loss_category);
      const prev = merged.get(key) || { key, label: labelOf(key), bucket: bucketOf(key), counts_as_loss: countsAsLoss(key), events: 0, minutes: 0 };
      prev.events += row.events;
      prev.minutes += row.total_min || 0;
      merged.set(key, prev);
    }
    const ordered = [...merged.values()].sort((a, b) => b.minutes - a.minutes);
    let totalLossMin = 0;
    const losses = ordered.map((row) => {
      if (row.counts_as_loss) totalLossMin += row.minutes;
      return {
        category: row.key,
        label: row.label,
        bucket: row.bucket,
        counts_as_loss: row.counts_as_loss,
        events: row.events,
        minutes: round2(row.minutes),
        pct_of_planned: shiftAgg.total_planned > 0 ? round2((row.minutes / shiftAgg.total_planned) * 100) : 0,
      };
    });

    res.json({
      period: { days: d, since },
      planned_minutes: round2(shiftAgg.total_planned || 0),
      actual_minutes: round2(shiftAgg.total_operating || 0),
      total_loss_minutes: round2(totalLossMin),
      losses,
      loss_catalog: LOSS_CATALOG,
      loss_category_mapping: LOSS_CATEGORY_MAPPING,
    });
  }));

  app.post("/api/oee/loss-events", wrap((req, res) => {
    const { equipment_instance_id, loss_category, start_time, end_time, duration_minutes, description } = req.body;
    if (!equipment_instance_id || !loss_category) {
      throw ApiError.validation("equipment_instance_id and loss_category required");
    }
    const key = normalizeKey(loss_category);
    const result = run(
      `INSERT INTO oee_loss_events (equipment_instance_id, loss_category, category_key, counts_as_loss, source, start_time, end_time, duration_minutes, description, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [equipment_instance_id, loss_category, key, countsAsLoss(key) ? 1 : 0, req.body.source || "manual",
        start_time || null, end_time || null, duration_minutes || null, description || null, req.user ? req.user.sub : null]
    );
    res.json({
      id: result.lastInsertRowid,
      equipment_instance_id,
      loss_category,
      category_key: key,
      label: labelOf(key),
      bucket: bucketOf(key),
      counts_as_loss: countsAsLoss(key),
    });
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
