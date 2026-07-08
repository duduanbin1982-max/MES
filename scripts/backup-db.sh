#!/bin/bash
# factory-mes 数据库自动备份
# 策略:
#   - 日备份保留 3 天，避免 SQLite 备份随 IoT 数据增长撑满系统盘
#   - 每周日复制一份 weekly 备份，保留 8 周
#   - 备份后检查磁盘剩余，低于 5GB 写入告警日志

set -euo pipefail

PROJECT_DIR="/home/dubin/factory-mes"
BACKUP_DIR="$PROJECT_DIR/backups"
WEEKLY_DIR="$BACKUP_DIR/weekly"
TS=$(date +%Y%m%d_%H%M%S)
DB_FILE="$PROJECT_DIR/data/mes.db"
DAILY_RETENTION_DAYS="${DAILY_RETENTION_DAYS:-3}"
WEEKLY_RETENTION_DAYS="${WEEKLY_RETENTION_DAYS:-56}"
MIN_FREE_GB="${MIN_FREE_GB:-5}"

mkdir -p "$BACKUP_DIR" "$WEEKLY_DIR"

if [ ! -s "$DB_FILE" ]; then
  echo "[backup] $(date '+%F %T') ERROR: DB not found or empty: $DB_FILE"
  exit 1
fi

BACKUP_FILE="$BACKUP_DIR/mes.db.${TS}"

# VACUUM INTO 输出一致性备份，同时压缩 SQLite 空洞页。
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".timeout 5000" "VACUUM INTO '$BACKUP_FILE'"
else
  cp "$DB_FILE" "$BACKUP_FILE"
fi

if [ ! -s "$BACKUP_FILE" ]; then
  echo "[backup] $(date '+%F %T') ERROR: backup failed or empty: $BACKUP_FILE"
  exit 1
fi

echo "[backup] $(date '+%F %T') saved → $(basename "$BACKUP_FILE") ($(du -h "$BACKUP_FILE" | cut -f1))"

# 每周日留一份周备份，避免日备份短保留导致无法回溯。
if [ "$(date +%u)" = "7" ]; then
  cp "$BACKUP_FILE" "$WEEKLY_DIR/mes.db.weekly.${TS}"
  echo "[backup] weekly snapshot saved → mes.db.weekly.${TS}"
fi

# VACUUM INTO 后不需要单独保留 WAL；老脚本留下的 WAL 也按日备保留期清理。
DELETED_DAILY=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "mes.db.20*" -mtime +"$DAILY_RETENTION_DAYS" -delete -print | wc -l)
DELETED_WAL=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "mes.db.20*-wal" -delete -print | wc -l)
DELETED_WEEKLY=$(find "$WEEKLY_DIR" -type f -name "mes.db.weekly.*" -mtime +"$WEEKLY_RETENTION_DAYS" -delete -print | wc -l)
echo "[backup] deleted daily=$DELETED_DAILY wal=$DELETED_WAL weekly=$DELETED_WEEKLY"

COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "mes.db.20*" | wc -l)
WEEKLY_COUNT=$(find "$WEEKLY_DIR" -type f -name "mes.db.weekly.*" | wc -l)
echo "[backup] total daily backups: $COUNT, weekly backups: $WEEKLY_COUNT"

AVAIL_GB=$(df -BG "$PROJECT_DIR" | awk 'NR==2 {gsub("G","",$4); print $4}')
if [ "${AVAIL_GB:-0}" -lt "$MIN_FREE_GB" ]; then
  echo "[backup] $(date '+%F %T') WARNING: disk free ${AVAIL_GB}GB < ${MIN_FREE_GB}GB"
fi
