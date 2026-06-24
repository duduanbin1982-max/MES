#!/bin/bash
# TLS 证书过期检查（30 天前告警到 mes.log + feishu 队列）

set -e
CERT="/home/dubin/factory-mes/ssl/cert.pem"
LOG="/home/dubin/factory-mes/backups/cron.log"
WARN_DAYS=30

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

# P1-#9 飞书告警 (证书 < 30 天)
if [ "$DAYS_LEFT" -lt "$WARN_DAYS" ]; then
  "$NODE" -e "require('/home/dubin/factory-mes/services/feishuNotify.js').feishuNotify('⚠ TLS 证书即将过期', '剩余 ${DAYS_LEFT} 天，请及时续期')" 2>/dev/null || true
fi
