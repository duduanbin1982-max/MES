#!/bin/bash
# factory-mes 数据库自动备份 (v2 改写)
# 关键修复:
#   - sqlite3 缺失时显式失败, 不再静默 cp
#   - 内容新鲜度校验 (audit_logs.max)
#   - 飞书告警 (成功/失败)
#   - 删除错误假设的 WAL 清理
set -euo pipefail
PROJECT_DIR="/home/dubin/factory-mes"
BACKUP_DIR="$PROJECT_DIR/backups"
WEEKLY_DIR="$BACKUP_DIR/weekly"
TS=$(date +%Y%m%d_%H%M%S)
DB_FILE="$PROJECT_DIR/data/mes.db"
DAILY_RETENTION_DAYS="${DAILY_RETENTION_DAYS:-3}"
WEEKLY_RETENTION_DAYS="${WEEKLY_RETENTION_DAYS:-56}"
MIN_FREE_GB="${MIN_FREE_GB:-5}"
NODE="/home/dubin/.nvm/versions/node/v22.22.3/bin/node"
mkdir -p "$BACKUP_DIR" "$WEEKLY_DIR"
if [ ! -s "$DB_FILE" ]; then
  echo "[backup] $(date '+%F %T') ERROR: DB not found or empty: $DB_FILE"
  exit 1
fi
BACKUP_FILE="$BACKUP_DIR/mes.db.${TS}"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".timeout 5000" "VACUUM INTO '$BACKUP_FILE'"
else
  echo "[backup] $(date '+%F %T') ERROR: sqlite3 not installed; refusing unsafe cp (WAL would be lost)"
  "$NODE" -e "require('/home/dubin/factory-mes/services/feishuNotify.js').feishuNotify('❌ MES 备份失败','sqlite3 未安装, 拒绝 cp')" 2>/dev/null || true
  exit 1
fi
if [ ! -s "$BACKUP_FILE" ]; then
  echo "[backup] $(date '+%F %T') ERROR: backup file empty: $BACKUP_FILE"
  exit 1
fi
MAX_SRC=$(sqlite3 "$DB_FILE" "SELECT max(created_at) FROM audit_logs;" 2>/dev/null || echo "")
MAX_BAK=$(sqlite3 "$BACKUP_FILE" "SELECT max(created_at) FROM audit_logs;" 2>/dev/null || echo "")
if [ -n "$MAX_SRC" ] && [ "$MAX_SRC" != "$MAX_BAK" ]; then
  echo "[backup] $(date '+%F %T') ERROR: backup stale (src=$MAX_SRC bak=$MAX_BAK)"
  "$NODE" -e "require('/home/dubin/factory-mes/services/feishuNotify.js').feishuNotify('❌ MES 备份过期',\"src=$MAX_SRC bak=$MAX_BAK\")" 2>/dev/null || true
  exit 1
fi
echo "[backup] $(date '+%F %T') saved → $(basename "$BACKUP_FILE") ($(du -h "$BACKUP_FILE" | cut -f1)) audit_max=$MAX_BAK"
"$NODE" -e "require('/home/dubin/factory-mes/services/feishuNotify.js').feishuNotify('✅ MES 备份完成',\"$(basename "$BACKUP_FILE") audit_max=$MAX_BAK\")" 2>/dev/null || true
if [ "$(date +%u)" = "7" ]; then
  cp "$BACKUP_FILE" "$WEEKLY_DIR/mes.db.weekly.${TS}"
  echo "[backup] weekly snapshot saved → mes.db.weekly.${TS}"
fi
DELETED_DAILY=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "mes.db.20*" -mtime +"$DAILY_RETENTION_DAYS" -delete -print | wc -l)
DELETED_WEEKLY=$(find "$WEEKLY_DIR" -type f -name "mes.db.weekly.*" -mtime +"$WEEKLY_RETENTION_DAYS" -delete -print | wc -l)
echo "[backup] deleted daily=$DELETED_DAILY weekly=$DELETED_WEEKLY"
COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "mes.db.20*" | wc -l)
WEEKLY_COUNT=$(find "$WEEKLY_DIR" -type f -name "mes.db.weekly.*" | wc -l)
echo "[backup] total daily backups: $COUNT, weekly backups: $WEEKLY_COUNT"
AVAIL_GB=$(df -BG "$PROJECT_DIR" | awk 'NR==2 {gsub("G","",$4); print $4}')
if [ "${AVAIL_GB:-0}" -lt "$MIN_FREE_GB" ]; then
  echo "[backup] $(date '+%F %T') WARNING: disk free ${AVAIL_GB}GB < ${MIN_FREE_GB}GB"
fi
