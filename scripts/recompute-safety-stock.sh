#!/bin/bash
# scripts/recompute-safety-stock.sh
# 安全库存自动计算 cron 包装
# 用法:
#   bash scripts/recompute-safety-stock.sh         # 跑一次
#   # 加 crontab: 0 3 * * * cd /home/dubin/factory-mes && bash scripts/recompute-safety-stock.sh >> data/safety-stock.log 2>&1
set -uo pipefail
ROOT=/home/dubin/factory-mes
NODE=/home/dubin/.nvm/versions/node/v22.22.3/bin/node
cd "$ROOT" || exit 1
echo "=== safety stock recompute $(date -Iseconds) ==="
"$NODE" "$ROOT/scripts/recompute-safety-stock.js"
