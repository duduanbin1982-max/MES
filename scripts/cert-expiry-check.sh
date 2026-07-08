#!/bin/bash
# TLS 证书过期检查（30 天前告警到 cron.log + 飞书队列）

set -euo pipefail
CERT="/home/dubin/factory-mes/ssl/cert.pem"
LOG="/home/dubin/factory-mes/backups/cron.log"
WARN_DAYS=30
NODE="/home/dubin/.nvm/versions/node/v22.22.3/bin/node"

if [ ! -f "$CERT" ]; then
  echo "[cert-check] $(date '+%F %T') cert not found: $CERT" >> "$LOG"
  exit 0
fi

EXPIRY_EPOCH=$(openssl x509 -in "$CERT" -noout -enddate | cut -d= -f2 | xargs -I{} date -d "{}" +%s)
NOW_EPOCH=$(date +%s)
DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

if [ "$DAYS_LEFT" -lt "$WARN_DAYS" ]; then
  echo "[cert-check] $(date '+%F %T') ⚠ 证书将在 ${DAYS_LEFT} 天后过期 (${EXPIRY_EPOCH})" >> "$LOG"
else
  echo "[cert-check] $(date '+%F %T') ✓ 证书还有 ${DAYS_LEFT} 天有效" >> "$LOG"
fi

if [ "$DAYS_LEFT" -lt "$WARN_DAYS" ]; then
  "$NODE" -e "require('/home/dubin/factory-mes/services/feishuNotify.js').feishuNotify('⚠ TLS 证书即将过期', '剩余 ${DAYS_LEFT} 天，请及时续期').then(()=>process.exit(0))" >> "$LOG" 2>&1 || true
fi
