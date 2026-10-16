#!/bin/bash
# scripts/logs-predeploy-cleanup.sh
# predeploy 日志目录清理 —— 2026-10-16 新增（批次四 · C 项）
#
# 【为什么需要这个脚本】
# logs/predeploy/ 下的日志由 pre-deploy-test.sh 以【时间戳命名】生成
# （predeploy-<ts>.log、frontend-domain-<ts>.log），属于【一次性文件】：
# 写完脚本就退出，此后不再追加。但它们落在 logrotate 规则
#     /home/dubin/factory-mes/logs/predeploy/*.log  (daily + copytruncate + notifempty)
# 的管辖范围内，于是每天 00:00 发生：
#     非空文件 → 压成 .1.gz；原文件被 copytruncate 截断为 0 字节
#     → 该文件此后无人写入
#     → 次日 logrotate 因 notifempty 跳过它（不再轮转）
#     → 0 字节壳【永远进不了 rotate 3 的清理范围】——因为 rotate 计数只在轮转时递增
# 结果：每个日志永久占 2 个 inode，且逐日累积（实测 8 天累积 412 个条目 / 156 个空壳）。
#
# pre-deploy-test.sh 里原有的 `find ... -mtime +3 -delete` 有三个缺陷：
#     ① 只匹配 predeploy-*.log，漏掉 frontend-domain-*.log
#     ② 只匹配 .log，漏掉全部轮转产物 .log.1.gz / .log.2.gz ...
#     ③ 只在「恰好发生了一次发布」时才执行 —— 不发布就永不清理
#
# 本脚本按【mtime】清理整个目录下的一切日志文件，两类文件名与轮转产物一并覆盖，
# 并挂 cron 每日兜底，不再依赖「恰好发布过」。
#
# 【清理口径】
#     1) 超过 PREDEPLOY_LOG_KEEP_DAYS 天（默认 14）未修改的文件 —— 一律删除
#     2) 0 字节且超过 1 小时未修改的空壳 —— 删除
#        （空壳内容已全部在 .gz 里，留着只有 inode 开销；加 1 小时门槛是为了
#          避免恰好撞上某次发布测试、误删正在写入的文件）
#
# 【安全边界】只删 logs/predeploy/ 下的【普通文件】，不递归、不动目录、不碰其它路径。
#
# 用法：
#   bash scripts/logs-predeploy-cleanup.sh            # 执行清理
#   bash scripts/logs-predeploy-cleanup.sh --dry-run  # 只列将被删除的文件，不删
# 可用环境变量覆盖：FACTORY_MES_ROOT、PREDEPLOY_LOG_KEEP_DAYS
set -u
set -o pipefail

ROOT="${FACTORY_MES_ROOT:-/home/dubin/factory-mes}"
LOG_DIR="$ROOT/logs/predeploy"
KEEP_DAYS="${PREDEPLOY_LOG_KEEP_DAYS:-14}"
SELF_LOG="$ROOT/logs/predeploy-cleanup.log"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

log() {
  local line="[logs-cleanup] $(date '+%F %T') $*"
  if [ "$DRY" = "1" ]; then
    echo "$line"
  else
    mkdir -p "$(dirname "$SELF_LOG")" 2>/dev/null || true
    echo "$line" | tee -a "$SELF_LOG"
  fi
}

[ -d "$LOG_DIR" ] || { log "目录不存在，无需清理: $LOG_DIR"; exit 0; }

BEFORE_FILES=$(find "$LOG_DIR" -maxdepth 1 -type f | wc -l)
BEFORE_SIZE=$(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)
ZERO_SHELLS=$(find "$LOG_DIR" -maxdepth 1 -type f -size 0 | wc -l)
EXPIRED=$(find "$LOG_DIR" -maxdepth 1 -type f -mtime +"$KEEP_DAYS" | wc -l)
EMPTY_OLD=$(find "$LOG_DIR" -maxdepth 1 -type f -size 0 -mmin +60 | wc -l)

log "开始: 保留 ${KEEP_DAYS} 天 | 现存 ${BEFORE_FILES} 个 / ${BEFORE_SIZE} | 其中空壳 ${ZERO_SHELLS} 个（>1h 的 ${EMPTY_OLD} 个）| 过期 ${EXPIRED} 个"

if [ "$DRY" = "1" ]; then
  echo "--- dry-run · 过期文件（>${KEEP_DAYS} 天）---"
  find "$LOG_DIR" -maxdepth 1 -type f -mtime +"$KEEP_DAYS" -printf '%TY-%Tm-%Td  %8s  %f\n' 2>/dev/null | sort
  echo "--- dry-run · 空壳（0 字节且 >1 小时未修改）---"
  find "$LOG_DIR" -maxdepth 1 -type f -size 0 -mmin +60 -printf '%TY-%Tm-%Td  %8s  %f\n' 2>/dev/null | sort
  exit 0
fi

DEL_EXPIRED=$(find "$LOG_DIR" -maxdepth 1 -type f -mtime +"$KEEP_DAYS" -print -delete 2>/dev/null | wc -l)
DEL_EMPTY=$(find "$LOG_DIR" -maxdepth 1 -type f -size 0 -mmin +60 -print -delete 2>/dev/null | wc -l)

AFTER_FILES=$(find "$LOG_DIR" -maxdepth 1 -type f | wc -l)
AFTER_SIZE=$(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)
log "完成: 删过期 ${DEL_EXPIRED} 个 + 删空壳 ${DEL_EMPTY} 个 = 共 $(( DEL_EXPIRED + DEL_EMPTY )) 个；现存 ${AFTER_FILES} 个 / ${AFTER_SIZE}"

# 若目录仍异常膨胀（超过 2000 条目），记为告警信号并退出码 1，便于巡检/cron 捕获
if [ "$AFTER_FILES" -gt 2000 ]; then
  log "WARN: 清理后仍有 ${AFTER_FILES} 个文件，超出预期（阈值 2000），请检查是否有异常高频写入"
  exit 1
fi
exit 0
