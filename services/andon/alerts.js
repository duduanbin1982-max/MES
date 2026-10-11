"use strict";
// services/andon/alerts.js
// 告警去重与触发。(原 services/andonService.js 第 36-60 行)

function createAlertEngine({ get, run, emit, Events }) {
  /**
   * 告警去重: 同一 source_type + source_id + alert_type 在 cooldown 内不重复触发
   */
  function isDuplicate(alertType, sourceType, sourceId, cooldownMin) {
    const recent = get(
      "SELECT id FROM andon_alerts WHERE alert_type = ? AND source_type = ? AND source_id = ? AND created_at > datetime('now','-' || ? || ' minutes') LIMIT 1",
      [alertType, sourceType, sourceId, cooldownMin || 60]
    );
    return !!recent;
  }

  /**
   * 触发告警
   */
  function triggerAlert(alertType, sourceType, sourceId, title, message, severity, data, cooldownMin) {
    if (isDuplicate(alertType, sourceType, sourceId || 0, cooldownMin)) return null;
    const r = run(
      `INSERT INTO andon_alerts (alert_type, source_type, source_id, title, message, severity, triggered_by, data_json)
       VALUES (?, ?, ?, ?, ?, ?, 'system', ?)`,
      [alertType, sourceType, sourceId || null, title, message || title, severity || "warning", data ? JSON.stringify(data) : null]
    );
    const id = Number(r.lastInsertRowid);
    emit(Events.ANDON_TRIGGERED, { alert_id: id, alert_type: alertType, severity, title, source_type: sourceType, source_id: sourceId });
    return id;
  }

  return { isDuplicate, triggerAlert };
}

module.exports = { createAlertEngine };
