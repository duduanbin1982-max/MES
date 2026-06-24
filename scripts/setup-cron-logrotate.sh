#!/bin/bash
# factory-mes 备份 cron 安装（批次 4 用户级）
# 用户级 crontab：每天 03:00 备份；不需要 sudo

chmod +x /home/dubin/factory-mes/scripts/backup-db.sh

# 安装用户级 crontab（不与系统级冲突）
CRON_LINE="0 3 * * * /home/dubin/factory-mes/scripts/backup-db.sh >> /home/dubin/factory-mes/backups/cron.log 2>&1"

# 检查是否已存在
( crontab -l 2>/dev/null | grep -v "factory-mes/scripts/backup-db" ; echo "$CRON_LINE" ) | crontab -

echo "✓ crontab 已安装"
crontab -l | grep factory-mes
