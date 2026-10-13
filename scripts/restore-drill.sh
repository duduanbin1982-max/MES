#!/bin/bash
# ⚠️ 2026-10-13 起停用（依赖 192.168.1.75）。本地恢复演练请用 scripts/restore-drill-local.sh。
# P2 恢复演练：从 192.168.1.75 离机备份拉取最新 DB 到临时目录，校验 sha256 和可读性。
# 不覆盖生产库；默认完成后清理临时目录。设置 RESTORE_DRILL_KEEP=1 可保留现场。
set -euo pipefail

ROOT="/home/dubin/factory-mes"
NODE="/home/dubin/.nvm/versions/node/v22.22.3/bin/node"
LOG="$ROOT/logs/restore-drill.log"
OFFSITE_USER="${OFFSITE_USER:-dubin}"
OFFSITE_HOST="${OFFSITE_HOST:-192.168.1.75}"
OFFSITE_ROOT="${OFFSITE_ROOT:-/home/dubin/mes-offsite-backups/192.168.1.73}"
OFFSITE_KEY="${OFFSITE_KEY:-/home/dubin/.ssh/factory_mes_offsite_ed25519}"
RUN_ID=$(date +%Y%m%d_%H%M%S)
WORK_DIR="${RESTORE_DRILL_WORK_DIR:-/tmp/factory-mes-restore-drill-$RUN_ID}"
KEEP="${RESTORE_DRILL_KEEP:-0}"

SSH_OPTS=(-i "$OFFSITE_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
RSYNC_SSH="ssh -i $OFFSITE_KEY -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"

mkdir -p "$ROOT/logs" "$WORK_DIR"
cd "$ROOT"

log() {
  echo "[restore-drill] $(date '+%F %T') $*" | tee -a "$LOG"
}

# 失败可诊断（2026-10-13 W1-2）：原来 set -e 中断后日志只留一行，无法判断失败在哪一步
trap 'rc=$?; log "FAILED rc=$rc at line $LINENO"; exit $rc' ERR

cleanup() {
  if [ "$KEEP" != "1" ]; then
    rm -rf "$WORK_DIR"
  else
    log "kept work dir: $WORK_DIR"
  fi
}
trap cleanup EXIT

if [ ! -f "$OFFSITE_KEY" ]; then
  log "ERROR: ssh key not found: $OFFSITE_KEY"
  exit 2
fi

REMOTE="$OFFSITE_USER@$OFFSITE_HOST"
log "fetch latest manifest from $REMOTE:$OFFSITE_ROOT"
MANIFEST_REMOTE=$(ssh "${SSH_OPTS[@]}" "$REMOTE" "ls -1t '$OFFSITE_ROOT'/manifests/manifest-*.json 2>/dev/null | head -1")
if [ -z "$MANIFEST_REMOTE" ]; then
  log "ERROR: no manifest found on offsite backup"
  exit 3
fi
rsync -a -e "$RSYNC_SSH" "$REMOTE:$MANIFEST_REMOTE" "$WORK_DIR/manifest.json"

DB_NAME=$(python3 - "$WORK_DIR/manifest.json" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["latest_db_backup"])
PY
)
EXPECTED_SHA=$(python3 - "$WORK_DIR/manifest.json" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["latest_db_sha256"])
PY
)

log "restore db candidate: $DB_NAME"
rsync -a --partial -e "$RSYNC_SSH" "$REMOTE:$OFFSITE_ROOT/daily/$DB_NAME" "$WORK_DIR/$DB_NAME"

ACTUAL_SHA=$(sha256sum "$WORK_DIR/$DB_NAME" | awk '{print $1}')
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  log "ERROR: sha256 mismatch expected=$EXPECTED_SHA actual=$ACTUAL_SHA"
  exit 4
fi
log "sha256 ok: $ACTUAL_SHA"

"$NODE" - "$WORK_DIR/$DB_NAME" <<'NODE'
const Database = require("better-sqlite3");
const dbPath = process.argv[2];
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const integrity = db.pragma("integrity_check", { simple: true });
if (integrity !== "ok") {
  console.error("integrity_check failed:", integrity);
  process.exit(5);
}
const tableCount = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().c;
const counts = {};
for (const table of ["equipment_instances", "materials", "bom", "work_orders", "audit_logs", "iot_readings", "iot_alarms"]) {
  const exists = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name=?").get(table).c;
  counts[table] = exists ? db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c : null;
}
console.log(JSON.stringify({ integrity, tableCount, counts }));
db.close();
NODE

log "success db=$DB_NAME work_dir=$WORK_DIR (sha256 已校验 / integrity_check 已通过，见上方 JSON)"
