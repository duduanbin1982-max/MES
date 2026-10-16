#!/bin/bash
# 每日运维巡检（只读）—— 2026-10-13 实施批次一 W1-4
# 2026-10-16 R5 修复：① 注入用户会话上下文，修掉 cron 下 systemctl --user 取不到状态
#                     ② 修正 mes.log 轮转检测的文件名模式，并改为按「最近轮转天数」判定
#                     ③ 轮转感知：drill/offsite 的「最近一次结果」改为跨轮转副本读取，
#                        且年龄改由记录自身时间戳计算（R4 生效后原实现会立即误报）
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
ALERT_MAX_OFFSITE_AGE_H=26   # 异地备份 cron 每日 03:30，本巡检 08:30；26h 可捕获「漏跑一次」

mkdir -p "$ROOT/logs"
log() { echo "[ops-check] $(date '+%F %T') $*" | tee -a "$LOG"; }

# --- 轮转感知工具（2026-10-16 R5 修复③）-------------------------------------
# 背景：R4 落盘后 logrotate 会把日志截断（copytruncate）并留下 .1/.1.gz 副本。
#       原实现只 grep 当前文件、只 stat 当前文件 mtime，于是「轮转当天」必然误报
#       「最近一次执行非成功」，且真出问题时年龄会被轮转“洗白”成 0（假阴性）。
# last_record <日志> <前缀正则>：当前日志无匹配时，回退到最近一次轮转副本。
last_record() {
  local f="$1" pat="$2" line="" gz=""
  [ -f "$f" ] && line=$(grep -E "$pat" "$f" 2>/dev/null | tail -1)
  if [ -z "$line" ]; then
    gz=$(ls -1t "$f".[0-9]* 2>/dev/null | head -1)
    if [ -n "$gz" ]; then
      case "$gz" in
        *.gz) line=$(zcat "$gz" 2>/dev/null | grep -E "$pat" | tail -1) ;;
        *)    line=$(grep -E "$pat" "$gz" 2>/dev/null | tail -1) ;;
      esac
    fi
  fi
  printf '%s' "$line"
}
# record_age_s <日志> <记录行>：取记录自身时间戳算年龄（秒）；解析失败时回退到
# 日志族最新 mtime；仍失败返回 -1（调用方须按「未知/异常」处理，不得当作 0）。
record_age_s() {
  local f="$1" rec="$2" ts="" e="" newest=""
  ts=$(printf '%s' "$rec" | sed -nE 's/^\[[^]]+\][[:space:]]*([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}).*/\1/p')
  if [ -n "$ts" ]; then
    e=$(date -d "$ts" +%s 2>/dev/null || true)
    if [ -n "$e" ]; then echo $(( $(date +%s) - e )); return 0; fi
  fi
  newest=$( { stat -c %Y "$f" 2>/dev/null; ls -1 "$f".[0-9]* 2>/dev/null | xargs -r stat -c %Y 2>/dev/null; } | sort -n | tail -1 )
  if [ -n "$newest" ]; then echo $(( $(date +%s) - newest )); return 0; fi
  echo -1
}
# -----------------------------------------------------------------------------

# systemctl --user 需要用户会话上下文（DBus）；cron 环境不提供，会返回 unknown。
# 本机已启用 linger，故显式注入这两个变量即可正常查询（2026-10-16 R5 修复）。
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

problems=()

# 1) 服务状态与健康
STATE=$(systemctl --user show factory-mes.service -p ActiveState --value 2>/dev/null || true)
RESTARTS=$(systemctl --user show factory-mes.service -p NRestarts --value 2>/dev/null || true)
HEALTH=$(curl -s -m 5 http://127.0.0.1:3890/api/health || echo "(no response)")
log "service: state=${STATE:-?} restarts=${RESTARTS:-?} health=${HEALTH:0:90}"
HEALTH_OK=0
case "$HEALTH" in *'"status":"ok"'*) HEALTH_OK=1 ;; esac
if [ "$STATE" = "active" ]; then
  :
elif [ "$HEALTH_OK" = "1" ]; then
  # systemd 查询不可用（state 为空 / unknown）但服务实际可达 → 记为「检测能力降级」，
  # 不再误报为「服务异常」（2026-10-16 R5 修复前每天固定误报一条）
  problems+=("systemd --user unavailable (state=${STATE:-empty}); service ok via /api/health")
else
  problems+=("service state=${STATE:-empty}")
fi
[ "$HEALTH_OK" = "1" ] || problems+=("health endpoint not ok")

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

# 3) 恢复演练新鲜度（本地演练；异地副本完整性演练为后续可选项）
LOCAL_DRILL_LOG="$ROOT/logs/restore-drill-local.log"
LAST_DRILL=$(last_record "$LOCAL_DRILL_LOG" '^\[drill-local\]')
if [ -n "$LAST_DRILL" ]; then
  DRILL_S=$(record_age_s "$LOCAL_DRILL_LOG" "$LAST_DRILL")
  DRILL_DAYS=$(( DRILL_S / 86400 ))
  log "drill(local): age=${DRILL_DAYS}d last=${LAST_DRILL:0:140}"
  case "$LAST_DRILL" in
    *success*) ;;
    *) problems+=("local restore drill last run not success") ;;
  esac
  [ "$DRILL_S" -ge 0 ] || problems+=("local restore drill record timestamp unparsable")
  [ "$DRILL_DAYS" -le 35 ] || problems+=("local restore drill stale: ${DRILL_DAYS}d")
else
  problems+=("no local restore drill log yet (运行 scripts/restore-drill-local.sh)")
fi
# 3b) 异地备份新鲜度与最近结果（2026-10-16 恢复启用，目标 192.168.1.10 Synology NAS）
LAST_OFFSITE=$(last_record "$OFFSITE_LOG" '^\[offsite\]')
if [ -n "$LAST_OFFSITE" ]; then
  OFF_S=$(record_age_s "$OFFSITE_LOG" "$LAST_OFFSITE")
  OFF_AGE_H=$(( OFF_S / 3600 ))
  log "offsite: age=${OFF_AGE_H}h last=${LAST_OFFSITE:0:140}"
  case "$LAST_OFFSITE" in
    *success*) ;;
    *) problems+=("offsite last run not success") ;;
  esac
  [ "$OFF_S" -ge 0 ] || problems+=("offsite record timestamp unparsable")
  [ "$OFF_AGE_H" -le "$ALERT_MAX_OFFSITE_AGE_H" ] || problems+=("offsite stale: ${OFF_AGE_H}h > ${ALERT_MAX_OFFSITE_AGE_H}h")
else
  problems+=("no offsite backup log yet")
fi

# 4) 日志轮转与体积
if [ -f "$MES_LOG" ]; then
  SIZE_MB=$(( $(stat -c %s "$MES_LOG") / 1048576 ))
  # 系统未启用 dateext，轮转文件实际命名为 mes.log.1 / mes.log.1.gz；
  # 原模式 'mes.log-*' 永远匹配不到，导致每天误报「未轮转」（2026-10-16 R5 修复）
  ROTATED=$(find "$ROOT/logs" -maxdepth 1 -name 'mes.log.[0-9]*' 2>/dev/null | wc -l)
  LAST_ROT=$(find "$ROOT/logs" -maxdepth 1 -name 'mes.log.[0-9]*' -printf '%TY-%Tm-%Td\n' 2>/dev/null | sort | tail -1)
  log "mes.log: ${SIZE_MB}MB rotated_files=$ROTATED last_rotate=${LAST_ROT:-never}"
  [ "$SIZE_MB" -le 20 ] || problems+=("mes.log ${SIZE_MB}MB > 20MB (logrotate 未生效?)")
  if [ -z "$LAST_ROT" ]; then
    problems+=("no rotated mes.log yet (检查 logrotate 配置)")
  else
    ROT_TS=$(date -d "$LAST_ROT" +%s 2>/dev/null || echo 0)
    ROT_DAYS=$(( ( $(date +%s) - ROT_TS ) / 86400 ))
    [ "$ROT_DAYS" -le 3 ] || problems+=("mes.log last rotated ${ROT_DAYS}d ago (>3d，logrotate 可能停摆)")
  fi
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
