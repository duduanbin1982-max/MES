#!/bin/bash
# factory-mes SQLite WAL checkpoint
# 用 node + better-sqlite3（项目自带，0 额外依赖）跑 PRAGMA wal_checkpoint(TRUNCATE)

set -e
DB="/home/dubin/factory-mes/data/mes.db"
LOG="/home/dubin/factory-mes/backups/cron.log"
NODE="/home/dubin/.nvm/versions/node/v22.22.3/bin/node"

if [ ! -f "$DB" ]; then
  echo "[wal-checkpoint] $(date '+%F %T') DB not found: $DB" >> "$LOG"
  exit 1
fi

WAL_BEFORE=$(stat -c %s "${DB}-wal" 2>/dev/null || echo 0)
"$NODE" -e "const D=require('/home/dubin/factory-mes/node_modules/better-sqlite3'); const db=new D('$DB'); db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); db.close();"
WAL_AFTER=$(stat -c %s "${DB}-wal" 2>/dev/null || echo 0)
SAVED=$((WAL_BEFORE - WAL_AFTER))

echo "[wal-checkpoint] $(date '+%F %T') WAL: ${WAL_BEFORE}B -> ${WAL_AFTER}B (saved ${SAVED}B)" >> "$LOG"

# P1-#8 飞书告警 (WAL > 100MB)
WAL_SIZE=$(stat -c %s "${DB}-wal" 2>/dev/null || echo 0)
if [ "$WAL_SIZE" -gt 104857600 ]; then
  WAL_MB=$(awk "BEGIN {printf \"%.1f\", ${WAL_SIZE}/1048576}")
  "$NODE" -e "require('/home/dubin/factory-mes/services/feishuNotify.js').feishuNotify('⚠ MES WAL 过大', '当前 ${WAL_MB}MB，建议检查')" 2>/dev/null || true
fi
