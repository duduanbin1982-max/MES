#!/bin/bash
# P2-#13 关键件到货倒计时检查
# 从本地 DB 查询长交期关键件，避免 cron 依赖 admin 登录/API token 字段。
# cron: 每周一 09:00 跑
set -euo pipefail

ROOT="/home/dubin/factory-mes"
NODE="/home/dubin/.nvm/versions/node/v22.22.3/bin/node"
LOG="$ROOT/backups/cron.log"

cd "$ROOT"

if ! DATA=$("$NODE" 2>>"$LOG" <<'NODE'
const db = require("./db");
const rows = db.prepare(`
  SELECT kc.*, m.material_name
  FROM key_components kc
  JOIN materials m ON kc.material_id = m.id
  WHERE kc.lead_time_weeks >= 12
  ORDER BY kc.lead_time_weeks DESC
`).all();
process.stdout.write(JSON.stringify(rows));
NODE
); then
  echo "[key-comp-check] $(date '+%F %T') error=query_failed" >> "$LOG"
  DATA="[]"
fi

HIGH_RISK=$(printf '%s' "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for i in d if (i.get('lead_time_weeks') or 0)>=16))")

if [ "$HIGH_RISK" -gt 0 ]; then
  LIST=$(printf '%s' "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); high=[i for i in d if (i.get('lead_time_weeks') or 0)>=16]; print('; '.join(f\"{i.get('material_name','未命名')}({i.get('lead_time_weeks')}w)\" for i in high))")
  MESSAGE="共 ${HIGH_RISK} 项 ≥ 16 周: ${LIST}"
  "$NODE" - "$MESSAGE" <<'NODE' 2>>"$LOG" || true
const { feishuNotify } = require("/home/dubin/factory-mes/services/feishuNotify.js");
const message = process.argv[2] || "";
feishuNotify("⚠ 长交期件预警", message).then(() => process.exit(0)).catch(() => process.exit(0));
NODE
fi

echo "[key-comp-check] $(date '+%F %T') high_risk=${HIGH_RISK}" >> "$LOG"
