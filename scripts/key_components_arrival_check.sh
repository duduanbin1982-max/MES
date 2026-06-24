#!/bin/bash
# P2-#13 关键件到货倒计时检查
# 拉 /api/key_components/long_leadtime → 高风险项 (lead_time_weeks >= 16) 推飞书
# cron: 每周一 09:00 跑
set -e
NODE="/home/dubin/.nvm/versions/node/v22.22.3/bin/node"
LOG="/home/dubin/factory-mes/backups/cron.log"

# 1) 拉长交期件
TOKEN=$(curl -s -X POST http://127.0.0.1:3890/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
DATA=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3890/api/key_components/long_leadtime")
HIGH_RISK=$(echo "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for i in d if i.get('lead_time_weeks',0)>=16))")

# 2) 高风险推飞书
if [ "$HIGH_RISK" -gt 0 ]; then
  LIST=$(echo "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); high=[i for i in d if i.get('lead_time_weeks',0)>=16]; print('; '.join(f\"{i['material_name']}({i.get('lead_time_weeks')}w)\" for i in high))")
  "$NODE" -e "require('/home/dubin/factory-mes/services/feishuNotify.js').feishuNotify('⚠ 长交期件预警', '共 ${HIGH_RISK} 项 ≥ 16 周: ${LIST}')" 2>/dev/null || true
fi

echo "[key-comp-check] $(date '+%F %T') high_risk=${HIGH_RISK}" >> "$LOG"
