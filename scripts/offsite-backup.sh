#!/bin/bash
# P0-3 离机备份：同步最新 DB 备份、上传文件和恢复配置到 192.168.1.75

set -euo pipefail

ROOT="/home/dubin/factory-mes"
BACKUP_DIR="$ROOT/backups"
LOG_DIR="$ROOT/logs"
LOG="$LOG_DIR/offsite-backup.log"
NODE="/home/dubin/.nvm/versions/node/v22.22.3/bin/node"

OFFSITE_USER="${OFFSITE_USER:-dubin}"
OFFSITE_HOST="${OFFSITE_HOST:-192.168.1.75}"
OFFSITE_ROOT="${OFFSITE_ROOT:-/home/dubin/mes-offsite-backups/192.168.1.73}"
OFFSITE_KEY="${OFFSITE_KEY:-/home/dubin/.ssh/factory_mes_offsite_ed25519}"
DAILY_RETENTION_DAYS="${OFFSITE_DAILY_RETENTION_DAYS:-30}"
WEEKLY_RETENTION_DAYS="${OFFSITE_WEEKLY_RETENTION_DAYS:-90}"

SSH_OPTS=(-i "$OFFSITE_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
RSYNC_SSH="ssh -i $OFFSITE_KEY -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"

mkdir -p "$LOG_DIR"
cd "$ROOT"

log() {
  echo "[offsite] $(date '+%F %T') $*" | tee -a "$LOG"
}

# 失败可诊断 + 失败必告警（2026-10-13 实施批次一 W1-1）
# 原脚本只有 set -e，失败时命令的 stderr 会进 cron 邮件而不进日志，
# 于是 2026-09-14 之后连续 4 周的失败在 offsite-backup.log 里只留下一行 "prepare remote dirs"。
alert_fail() {
  local rc=$1 line=$2
  log "FAILED rc=$rc at line $line"
  "$NODE" -e "require('$ROOT/services/feishuNotify.js').feishuNotify('❌ MES 异地备份失败','rc=$rc line=$line 详见 logs/offsite-backup.log')" 2>/dev/null || true
}
trap 'rc=$?; alert_fail "$rc" "$LINENO"; exit $rc' ERR

# 所有 stderr 追加进日志（含命令替换里的 ssh/rsync）
exec 2> >(while IFS= read -r _l; do echo "[offsite][stderr] $_l" >> "$LOG"; done)

if [ ! -f "$OFFSITE_KEY" ]; then
  log "ERROR: ssh key not found: $OFFSITE_KEY"
  exit 2
fi

LATEST_DB=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "mes.db.20*" ! -name "*-wal" -printf '%T@ %p\n' | sort -nr | awk 'NR==1{print $2}')
if [ -z "${LATEST_DB:-}" ] || [ ! -s "$LATEST_DB" ]; then
  log "ERROR: no local DB backup found under $BACKUP_DIR"
  exit 3
fi

REMOTE="$OFFSITE_USER@$OFFSITE_HOST"
RUN_ID=$(date +%Y%m%d_%H%M%S)
WORK_DIR="$ROOT/.tmp/offsite-$RUN_ID"
mkdir -p "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

log "prepare remote dirs on $REMOTE:$OFFSITE_ROOT"
ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$OFFSITE_ROOT/daily' '$OFFSITE_ROOT/weekly' '$OFFSITE_ROOT/uploads' '$OFFSITE_ROOT/config' '$OFFSITE_ROOT/manifests'"

log "sync latest db backup: $(basename "$LATEST_DB")"
rsync -a --partial --inplace -e "$RSYNC_SSH" "$LATEST_DB" "$REMOTE:$OFFSITE_ROOT/daily/"

if [ -d "$BACKUP_DIR/weekly" ]; then
  log "sync weekly snapshots"
  rsync -a --ignore-existing -e "$RSYNC_SSH" "$BACKUP_DIR/weekly/" "$REMOTE:$OFFSITE_ROOT/weekly/"
fi

log "sync uploads"
rsync -a --delete -e "$RSYNC_SSH" "$ROOT/data/uploads/" "$REMOTE:$OFFSITE_ROOT/uploads/" 2>/dev/null || true

CONFIG_TGZ="$WORK_DIR/config-$RUN_ID.tgz"
tar -czf "$CONFIG_TGZ" \
  --ignore-failed-read \
  .env .env.example package.json package-lock.json factory-mes.service \
  nginx/factory-mes.conf \
  scripts/backup-db.sh scripts/iot-lifecycle.sh scripts/offsite-backup.sh \
  scripts/wal-checkpoint.sh scripts/cert-expiry-check.sh \
  docs/deploy.md docs/iot-lifecycle.md 2>/dev/null || true
chmod 600 "$CONFIG_TGZ"
log "sync config snapshot"
rsync -a -e "$RSYNC_SSH" "$CONFIG_TGZ" "$REMOTE:$OFFSITE_ROOT/config/"

MANIFEST="$WORK_DIR/manifest-$RUN_ID.json"
DB_SHA=$(sha256sum "$LATEST_DB" | awk '{print $1}')
DB_SIZE=$(stat -c '%s' "$LATEST_DB")
UPLOAD_COUNT=$(find "$ROOT/data/uploads" -type f 2>/dev/null | wc -l || true)
UPLOAD_SIZE=$(du -sb "$ROOT/data/uploads" 2>/dev/null | awk '{print $1}' || echo 0)
GIT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo unknown)
GIT_TAGS=$(git tag --points-at HEAD 2>/dev/null | tr '\n' ',' | sed 's/,$//' || true)
DB_COUNTS=$("$NODE" - <<'NODE'
const db = require('./db');
const tableCount = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().c;
const readings = db.prepare("SELECT COUNT(*) c FROM iot_readings").get().c;
const hourly = db.prepare("SELECT COUNT(*) c FROM iot_reading_hourly").get().c;
const alarms = db.prepare("SELECT COUNT(*) c FROM iot_alarms").get().c;
console.log(JSON.stringify({ tableCount, iot_readings: readings, iot_reading_hourly: hourly, iot_alarms: alarms }));
NODE
)
cat > "$MANIFEST" <<JSON
{
  "run_id": "$RUN_ID",
  "created_at": "$(date -Is)",
  "source_host": "192.168.1.73",
  "target": "$OFFSITE_HOST:$OFFSITE_ROOT",
  "git_head": "$GIT_HEAD",
  "git_tags": "$GIT_TAGS",
  "latest_db_backup": "$(basename "$LATEST_DB")",
  "latest_db_size": $DB_SIZE,
  "latest_db_sha256": "$DB_SHA",
  "uploads_count": $UPLOAD_COUNT,
  "uploads_size": $UPLOAD_SIZE,
  "db_counts": $DB_COUNTS
}
JSON
log "sync manifest"
rsync -a -e "$RSYNC_SSH" "$MANIFEST" "$REMOTE:$OFFSITE_ROOT/manifests/"

log "remote retention cleanup"
ssh "${SSH_OPTS[@]}" "$REMOTE" "
  find '$OFFSITE_ROOT/daily' -type f -name 'mes.db.20*' -mtime +$DAILY_RETENTION_DAYS -delete
  find '$OFFSITE_ROOT/weekly' -type f -name 'mes.db.weekly.*' -mtime +$WEEKLY_RETENTION_DAYS -delete
  find '$OFFSITE_ROOT/config' -type f -name 'config-*.tgz' -mtime +$DAILY_RETENTION_DAYS -delete
  find '$OFFSITE_ROOT/manifests' -type f -name 'manifest-*.json' -mtime +$DAILY_RETENTION_DAYS -delete
"

REMOTE_DU=$(ssh "${SSH_OPTS[@]}" "$REMOTE" "du -sh '$OFFSITE_ROOT' 2>/dev/null | awk '{print \$1}'")
log "success latest=$(basename "$LATEST_DB") sha256=$DB_SHA remote_size=$REMOTE_DU"
