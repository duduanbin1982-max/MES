#!/bin/bash
# 每日运维巡检（只读）—— 2026-10-13 实施批次一 W1-4
# 检查：服务状态与健康、备份新鲜度与完整性、异地备份最近结果、日志轮转与体积
# 输出一行 ROSTER 摘要 + 明细；发现问题时通过飞书告警（失败不阻断巡检）。
set -uo pipefail

ROOT="/home/dubin/factory-mes"
NODE="/home/dubin/.nvm/versions/node/v22.22.3/bin/node"
LOG="$ROOT/logs/ops-daily-check.log"
DB="$ROOT/data/mes.db"
BACKUP_DIR="$ROOT/backups"
OFFSITE_LOG="$ROOT/logs/offsite-backup.log"
MES_LOG="$ROOT/logs/mes.log"
ALERT_MAX_BACKUP_AGE_H=6

mkdir -p "$ROOT/logs"
log() { echo "[ops-check] $(date '+%F %T') $*" | tee -a "$LOG"; }

problems=()

# 1) 服务状态与健康
STATE=$(systemctl --user show factory-mes.service -p ActiveState --value 2>/dev/null || echo unknown)
RESTARTS=$(systemctl --user show factory-mes.service -p NRestarts --value 2>/dev/null || echo "?")
HEALTH=$(curl -s -m 5 http://127.0.0.1:3890/api/health || echo "(no response)")
log "service: state=$STATE restarts=$RESTARTS health=${HEALTH:0:90}"
[ "$STATE" = "active" ] || problems+=("service state=$STATE")
case "$HEALTH" in *'"status":"ok"'*) ;; *) problems+=("health endpoint not ok") ;; esac

# 2) 备份新鲜度与完整性
LATEST=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'mes.db.20*' ! -name '*-wal' -printf '%T@ %p\n' 2>/dev/null | sort -nr | awk 'NR==1{print $2}')
if [ -z "${LATEST:-}" ]; then
  problems+=("no local db backup found")
  log "backup: MISSING"
else
  AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$LATEST") ) / 3600 ))
  CHECK=$("$NODE" -e "const D=require('$ROOT/node_modules/better-sqlite3');const db=new D(process.argv[1],{readonly:true});console.log(db.pragma('quick_check',{simple:true}));db.close();" "$LATEST" 2>&1 | tail -1)
  log "backup: $(basename "$LATEST") age=${AGE_H}h quick_check=$CHECK"
  [ "$AGE_H" -le "$ALERT_MAX_BACKUP_AGE_H" ] || problems+=("backup age ${AGE_H}h > ${ALERT_MAX_BACKUP_AGE_H}h")
  [ "$CHECK" = "ok" ] || problems+=("backup quick_check=$CHECK")
fi
DAILY_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'mes.db.20*' ! -name '*-wal' 2>/dev/null | wc -l)
WEEKLY_COUNT=$(find "$BACKUP_DIR/weekly" -maxdepth 1 -type f -name 'mes.db.weekly.*' 2>/dev/null | wc -l)
log "backup inventory: daily=$DAILY_COUNT weekly=$WEEKLY_COUNT"

# 3) 异地备份最近结果
if [ -f "$OFFSITE_LOG" ]; then
  LAST_OFFSITE=$(grep -E '^\[offsite\]' "$OFFSITE_LOG" | tail -1)
  log "offsite: $LAST_OFFSITE"
  case "$LAST_OFFSITE" in
    *success*) ;;
    *) problems+=("offsite backup last line not success: $LAST_OFFSITE") ;;
  esac
else
  problems+=("offsite log missing")
fi

# 4) 日志轮转与体积
if [ -f "$MES_LOG" ]; then
  SIZE_MB=$(( $(stat -c %s "$MES_LOG") / 1048576 ))
  ROTATED=$(find "$ROOT/logs" -maxdepth 1 -name 'mes.log-*' 2>/dev/null | wc -l)
  LAST_ROT=$(find "$ROOT/logs" -maxdepth 1 -name 'mes.log-*' -printf '%TY-%Tm-%Td\n' 2>/dev/null | sort | tail -1)
  log "mes.log: ${SIZE_MB}MB rotated_files=$ROTATED last_rotate=${LAST_ROT:-never}"
  [ "$SIZE_MB" -le 20 ] || problems+=("mes.log ${SIZE_MB}MB > 20MB (logrotate 未生效?)")
  if [ "$ROTATED" = "0" ]; then problems+=("no rotated mes.log yet (检查 logrotate 配置)"); fi
fi

# 5) WAL 体积
if [ -f "$DB-wal" ]; then
  WAL_MB=$(( $(stat -c %s "$DB-wal") / 1048576 ))
  log "wal: ${WAL_MB}MB"
  [ "$WAL_MB" -le 100 ] || problems+=("wal ${WAL_MB}MB > 100MB")
fi

if [ ${#problems[@]} -eq 0 ]; then
  log "ROSTER: OK"
else
  log "ROSTER: ${#problems[@]} issue(s)"
  for i in "${problems[@]}"; do log "  - $i"; done
  "$NODE" -e "require('$ROOT/services/feishuNotify.js').feishuNotify('⚠️ MES 每日巡检发现问题', process.argv[1])" "$(printf '%s; ' "${problems[@]}")" 2>/dev/null || true
fi
