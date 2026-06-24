#!/bin/bash
# factory-mes 数据库自动备份（批次 4）
# 保留最近 30 天，超过 30 天的自动删除

set -e

PROJECT_DIR="/home/dubin/factory-mes"
BACKUP_DIR="$PROJECT_DIR/backups"
TS=$(date +%Y%m%d_%H%M%S)
DB_FILE="$PROJECT_DIR/data/mes.db"

mkdir -p "$BACKUP_DIR"

# 备份主 DB（VACUUM INTO 先压缩，更省空间）
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".timeout 5000" "VACUUM INTO '$BACKUP_DIR/mes.db.${TS}'"
else
  cp "$DB_FILE" "$BACKUP_DIR/mes.db.${TS}"
fi

# 同时复制 WAL（如果有未 checkpoint 的事务）
[ -f "$DB_FILE-wal" ] && cp "$DB_FILE-wal" "$BACKUP_DIR/mes.db.${TS}-wal" || true

echo "[backup] $(date '+%F %T') saved → mes.db.${TS} ($(du -h "$BACKUP_DIR/mes.db.${TS}" | cut -f1))"

# 删除 7 天前的备份
DELETED=$(find "$BACKUP_DIR" -name "mes.db.*" -mtime +30 -delete -print | wc -l)
echo "[backup] deleted $DELETED old backups (>7 days)"

# 当前备份数量
COUNT=$(ls "$BACKUP_DIR" | wc -l)
echo "[backup] total backups: $COUNT"
