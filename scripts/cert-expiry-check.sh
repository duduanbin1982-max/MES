#!/bin/bash
# TLS 证书过期检查（P0-A1 2026-10-18：内网 CA 版）
# 检查两件事：① 服务端证书（ssl/cert.pem）剩余天数 ② 根 CA（ssl/tbm-root-ca.crt）剩余天数
# 任一 < 30 天 → cron.log 告警 + 飞书队列（飞书未启用时只写审计日志）
set -euo pipefail
ROOT="/home/dubin/factory-mes"
LOG="$ROOT/backups/cron.log"
WARN_DAYS=30
NODE="/home/dubin/.nvm/versions/node/v22.22.3/bin/node"

check_cert() {
  local label="$1" file="$2"
  if [ ! -f "$file" ]; then
    echo "[cert-check] $(date '+%F %T') ✗ $label 证书不存在: $file" >> "$LOG"
    return 1
  fi
  local expiry_epoch now_epoch days_left subject issuer
  expiry_epoch=$(openssl x509 -in "$file" -noout -enddate | cut -d= -f2 | xargs -I{} date -d "{}" +%s)
  now_epoch=$(date +%s)
  days_left=$(( (expiry_epoch - now_epoch) / 86400 ))
  subject=$(openssl x509 -in "$file" -noout -subject | sed 's/subject=//' | xargs)
  issuer=$(openssl x509 -in "$file" -noout -issuer | sed 's/issuer=//' | xargs)
  if [ "$days_left" -lt "$WARN_DAYS" ]; then
    echo "[cert-check] $(date '+%F %T') ⚠ $label 将在 ${days_left} 天后过期 | issuer=$issuer" >> "$LOG"
    return 2
  fi
  echo "[cert-check] $(date '+%F %T') ✓ $label 还有 ${days_left} 天有效 | subject=$subject | issuer=$issuer" >> "$LOG"
  return 0
}

rc=0
check_cert "server" "$ROOT/ssl/cert.pem" || rc=$?
check_cert "root-ca" "$ROOT/ssl/tbm-root-ca.crt" || rc=$?

if [ "$rc" = "2" ]; then
  "$NODE" -e "require('$ROOT/services/feishuNotify.js').feishuNotify('⚠ TLS 证书即将过期', '请检查 ssl/ 下的 server 与 root-ca，剩余不足 ${WARN_DAYS} 天').then(()=>process.exit(0))" >> "$LOG" 2>&1 || true
fi
