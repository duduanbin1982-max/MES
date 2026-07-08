#!/bin/bash
# P0-2 IoT 数据生命周期治理：小时聚合 + 原始数据/已确认报警保留策略

set -euo pipefail
ROOT="/home/dubin/factory-mes"
NODE="/home/dubin/.nvm/versions/node/v22.22.3/bin/node"
LOG="$ROOT/logs/iot-lifecycle.log"
RAW_DAYS="${IOT_RAW_READING_RETENTION_DAYS:-7}"
ALARM_DAYS="${IOT_ACKED_ALARM_RETENTION_DAYS:-30}"

mkdir -p "$ROOT/logs"
cd "$ROOT"

"$NODE" - <<NODE >> "$LOG" 2>&1
require('dotenv').config({ quiet: true });
const db = require('./db');
const lifecycle = require('./services/iotLifecycleService');
try {
  const result = lifecycle.runLifecycle(db, {
    rawReadingDays: Number(process.env.IOT_RAW_READING_RETENTION_DAYS || "$RAW_DAYS"),
    ackedAlarmDays: Number(process.env.IOT_ACKED_ALARM_RETENTION_DAYS || "$ALARM_DAYS"),
  });
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...result }));
} catch (error) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), status: "failed", error: error.message }));
  process.exit(1);
}
NODE
