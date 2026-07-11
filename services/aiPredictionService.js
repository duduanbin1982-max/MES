"use strict";
const { ApiError } = require('../app/errors');
const { wrap } = require('../middleware/asyncHandler');
const modelTraining = require("./ai/modelTraining");
// services/aiPredictionService.js
// P2-5 AI Prediction: Fault probability + Quality trend + Anomaly detection
// Lightweight statistical approach (no heavy ML libs)

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      prediction_type TEXT NOT NULL,
      predicted_value REAL,
      confidence REAL,
      threshold_low REAL,
      threshold_high REAL,
      status TEXT NOT NULL DEFAULT 'active',
      predicted_at TEXT NOT NULL DEFAULT (datetime('now')),
      validated_at TEXT,
      actual_value REAL,
      accuracy REAL,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS ai_anomaly_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_name TEXT NOT NULL,
      target_table TEXT,
      target_field TEXT,
      method TEXT NOT NULL DEFAULT 'zscore',
      window_size INTEGER NOT NULL DEFAULT 30,
      threshold REAL NOT NULL DEFAULT 2.0,
      min_data_points INTEGER NOT NULL DEFAULT 10,
      severity TEXT NOT NULL DEFAULT 'warning',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ai_anomaly_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER,
      target_type TEXT,
      target_id INTEGER,
      anomaly_score REAL,
      actual_value REAL,
      expected_value REAL,
      deviation_pct REAL,
      message TEXT,
      severity TEXT,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_pred_target ON ai_predictions(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_ai_anomaly_events ON ai_anomaly_events(created_at, acknowledged);
  `);
}

function makeHelpers(db) {
  return {
    all: (sql, p) => db.prepare(sql).all(...(p||[])),
    get: (sql, p) => db.prepare(sql).get(...(p||[])),
    run: (sql, p) => db.prepare(sql).run(...(p||[]))
  };
}

// === Statistical helpers ===
function mean(arr) { return arr.reduce((a,b)=>a+b,0)/arr.length; }
function stddev(arr) { const m=mean(arr); return Math.sqrt(arr.reduce((a,b)=>a+(b-m)*(b-m),0)/(arr.length-1||1)); }
function zscore(val, arr) { const m=mean(arr), s=stddev(arr); return s===0?0:(val-m)/s; }
function linearRegression(xy) { let sx=0,sy=0,sxx=0,sxy=0,n=xy.length; for(const p of xy) { sx+=p.x; sy+=p.y; sxx+=p.x*p.x; sxy+=p.x*p.y; } const den=n*sxx-sx*sx; if(den===0) return {slope:0,intercept:sy/n}; const slope=(n*sxy-sx*sy)/den; return {slope, intercept:(sy-slope*sx)/n}; }

// === Equipment Fault Prediction ===
function registerFaultPrediction(app, db) {
  const { all, get, run } = makeHelpers(db);

  app.post("/api/ai/predict/fault", wrap((req, res) => {
    const { device_code, hours_back } = req.body;
    if (!device_code) throw ApiError.validation("device_code required")
    const h = Number.isFinite(Number(hours_back)) ? Math.abs(Number(hours_back)) : 168;

    const dev = get("SELECT id, device_name FROM iot_devices WHERE device_code=?", [device_code]);
    if (!dev) throw ApiError.notFound("Device not found")

    const trainedPrediction = modelTraining.predictFaultWithModels(db, device_code, h);
    if (trainedPrediction) return res.json(trainedPrediction);

    const readings = all(
      "SELECT r.value, r.read_at, dp.point_name, dp.alarm_high FROM iot_readings r JOIN iot_data_points dp ON r.point_id=dp.id WHERE r.device_id=? AND r.read_at >= datetime('now','-" + h + " hours') ORDER BY r.read_at",
      [dev.id]
    );
    if (readings.length < 10) return res.json({ device_code, status: "insufficient_data", message: "Need at least 10 readings for prediction", readings_count: readings.length });

    const values = readings.map(r => r.value);
    const avg = mean(values);
    const sd = stddev(values);
    const trend = linearRegression(values.map((v,i)=>({x:i, y:v})));
    const alarmHigh = readings[0].alarm_high || 999999;
    const faultRisk = Math.min(100, Math.max(0,
      (avg > alarmHigh * 0.7 ? 40 : 0) +
      (sd > avg * 0.3 ? 30 : 0) +
      (trend.slope > 0 ? 30 : 0)
    ));
    const predictedHours = faultRisk > 70 ? Math.round((alarmHigh - avg) / Math.max(trend.slope, 0.0001)) : null;

    run("INSERT INTO ai_predictions (target_type,target_id,prediction_type,predicted_value,confidence,threshold_high,status,notes) VALUES (?,?,?,?,?,?,?,?)",
      ["device", dev.id, "fault_risk", faultRisk, Math.round(sd/(avg||1)*100)/100, alarmHigh, faultRisk>50?"warning":"active",
       "avg:"+avg.toFixed(2)+" sd:"+sd.toFixed(2)+" slope:"+trend.slope.toFixed(4)]);

    res.json({
      device_code, device_name: dev.device_name,
      fault_risk_pct: Math.round(faultRisk),
      trend_direction: trend.slope > 0 ? "rising" : (trend.slope < 0 ? "falling" : "stable"),
      current_avg: Math.round(avg * 100) / 100,
      stddev: Math.round(sd * 100) / 100,
      alarm_threshold: alarmHigh,
      predicted_failure_hours: predictedHours,
      readings_analyzed: readings.length,
      recommendation: faultRisk > 70 ? "建议停机检查" : (faultRisk > 40 ? "加强监控" : "正常")
    });
  }));
}

// === Quality Trend Prediction ===
function registerQualityPrediction(app, db) {
  const { all, get, run } = makeHelpers(db);

  app.post("/api/ai/predict/quality", wrap((req, res) => {
    const { instance_id, days_back } = req.body;
    if (!instance_id) throw ApiError.validation("instance_id required")
    const d = Number.isFinite(Number(days_back)) ? Math.abs(Number(days_back)) : 90;

    const inspections = all(
      "SELECT qi.*, qi.inspection_type FROM qc_inspections qi JOIN work_orders wo ON qi.work_order_id=wo.id WHERE wo.equipment_instance_id=? AND qi.inspection_date >= datetime('now','-" + d + " days') ORDER BY qi.inspected_at",
      [instance_id]
    );
    if (inspections.length < 5) return res.json({ status: "insufficient_data", message: "Need at least 5 inspections" });

    const passRate = inspections.filter(i => i.result === "pass" || i.result === "ok").length / inspections.length * 100;
    const recent = inspections.slice(-20);
    const recentPassRate = recent.filter(i => i.result === "pass" || i.result === "ok").length / recent.length * 100;
    const trend = recentPassRate - passRate;

    // Simplified: predict next period pass rate
    const predictedPassRate = Math.min(100, Math.max(0, recentPassRate + (trend * 0.3)));

    run("INSERT INTO ai_predictions (target_type,target_id,prediction_type,predicted_value,confidence,notes) VALUES (?,?,?,?,?,?)",
      ["equipment_instance", instance_id, "quality_pass_rate", Math.round(predictedPassRate), Math.round(passRate)/100,
       "historical:"+Math.round(passRate)+"% recent:"+Math.round(recentPassRate)+"%"]);

    res.json({
      instance_id,
      historical_pass_rate: Math.round(passRate),
      recent_pass_rate: Math.round(recentPassRate),
      trend: trend > 0 ? "improving" : (trend < 0 ? "declining" : "stable"),
      predicted_pass_rate: Math.round(predictedPassRate),
      total_inspections: inspections.length,
      recommendation: predictedPassRate < 85 ? "质量趋势下降，建议排查工艺" : (predictedPassRate < 95 ? "持续关注" : "质量稳定")
    });
  }));
}

// === Anomaly Detection ===
function registerAnomalyDetection(app, db) {
  const { all, get, run } = makeHelpers(db);

  app.get("/api/ai/anomaly-rules", wrap((req, res) => {
    res.json(all("SELECT * FROM ai_anomaly_rules WHERE is_active=1 ORDER BY id"));
  }));

  app.post("/api/ai/anomaly-rules", wrap((req, res) => {
    const { rule_name, target_table, target_field, method, window_size, threshold, min_data_points, severity } = req.body;
    if (!rule_name) throw ApiError.validation("rule_name required")
    const r = run("INSERT INTO ai_anomaly_rules (rule_name,target_table,target_field,method,window_size,threshold,min_data_points,severity) VALUES (?,?,?,?,?,?,?,?)",
      [rule_name, target_table||null, target_field||null, method||"zscore", window_size||30, threshold||2.0, min_data_points||10, severity||"warning"]);
    res.json({ id: r.lastInsertRowid, rule_name });
  }));

  // Run anomaly detection on IoT readings for a device
  app.post("/api/ai/detect/anomalies", wrap((req, res) => {
    const { device_code, hours_back } = req.body;
    if (!device_code) throw ApiError.validation("device_code required")
    const h = Number.isFinite(Number(hours_back)) ? Math.abs(Number(hours_back)) : 24;

    const dev = get("SELECT id FROM iot_devices WHERE device_code=?", [device_code]);
    if (!dev) throw ApiError.notFound("Device not found")

    const readings = all(
      "SELECT r.id, r.value, r.read_at, dp.point_name FROM iot_readings r JOIN iot_data_points dp ON r.point_id=dp.id WHERE r.device_id=? AND r.read_at >= datetime('now','-" + h + " hours') ORDER BY r.read_at",
      [dev.id]
    );

    if (readings.length < 10) return res.json({ anomalies_found: 0, message: "Insufficient data" });

    const values = readings.map(r => r.value);
    const anomalies = [];

    for (let i = 0; i < readings.length; i++) {
      const z = zscore(readings[i].value, values);
      if (Math.abs(z) > 2.5) {
        anomalies.push({
          reading_id: readings[i].id, value: readings[i].value,
          zscore: Math.round(z * 100) / 100,
          point_name: readings[i].point_name, read_at: readings[i].read_at
        });
        run("INSERT INTO ai_anomaly_events (target_type,target_id,anomaly_score,actual_value,expected_value,deviation_pct,message,severity) VALUES (?,?,?,?,?,?,?,?)",
          ["device", dev.id, Math.round(Math.abs(z)*100)/100, readings[i].value, mean(values),
           Math.round(Math.abs((readings[i].value-mean(values))/mean(values)*100)),
           "Anomaly: " + readings[i].point_name + "=" + readings[i].value, Math.abs(z) > 3 ? "critical" : "warning"]);
      }
    }

    res.json({ device_code, readings_analyzed: readings.length, anomalies_found: anomalies.length, anomalies });
  }));

  app.get("/api/ai/anomaly-events", wrap((req, res) => {
    const { acknowledged, severity } = req.query;
    let sql = "SELECT * FROM ai_anomaly_events WHERE 1=1";
    const p = [];
    if (acknowledged !== undefined) { sql += " AND acknowledged=?"; p.push(acknowledged); }
    if (severity) { sql += " AND severity=?"; p.push(severity); }
    sql += " ORDER BY created_at DESC LIMIT 200";
    res.json(all(sql, p));
  }));
}

// === Dashboard ===
function registerDashboard(app, db) {
  // wrap imported from middleware/asyncHandler
  app.get("/api/ai/dashboard", wrap((req, res) => {
    const recentPredictions = db.prepare("SELECT COUNT(*) AS c FROM ai_predictions WHERE predicted_at >= datetime('now','-7 days')").get().c;
    const highRisk = db.prepare("SELECT COUNT(*) AS c FROM ai_predictions WHERE predicted_value > 50 AND status='warning'").get().c;
    const unackAnomalies = db.prepare("SELECT COUNT(*) AS c FROM ai_anomaly_events WHERE acknowledged=0").get().c;
    const activeRules = db.prepare("SELECT COUNT(*) AS c FROM ai_anomaly_rules WHERE is_active=1").get().c;
    const latestPreds = db.prepare("SELECT * FROM ai_predictions ORDER BY predicted_at DESC LIMIT 5").all();
    res.json({
      predictions_7d: recentPredictions,
      high_risk_count: highRisk,
      unack_anomalies: unackAnomalies,
      active_rules: activeRules,
      latest_predictions: latestPreds
    });
  }));
}

function register(app, db) {
  runMigration(db);
  modelTraining.register(app, db);
  registerFaultPrediction(app, db);
  registerQualityPrediction(app, db);
  registerAnomalyDetection(app, db);
  registerDashboard(app, db);
  console.log("[aiPredictionService] AI Prediction registered (Training + Fault + Quality + Anomaly + Dashboard)");
}

module.exports = { register };