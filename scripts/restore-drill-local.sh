#!/bin/bash
# 本地恢复演练 —— 2026-10-13 新增（决策：取消异地备份后，仍要证明"备份可用"）
# 做法：取最新本地备份（或指定的周备）→ 复制到临时目录 → sha256 → integrity_check
#       → 表数与关键表行数 → 与生产库比对 → 全程写日志；不覆盖生产库。
set -euo pipefail

ROOT="/home/dubin/factory-mes"
NODE="/home/dubin/.nvm/versions/node/v22.22.3/bin/node"
LOG="$ROOT/logs/restore-drill-local.log"
BACKUP_DIR="$ROOT/backups"
DB="$ROOT/data/mes.db"
RUN_ID=$(date +%Y%m%d_%H%M%S)
WORK_DIR="${RESTORE_DRILL_WORK_DIR:-/tmp/mes-local-drill-$RUN_ID}"
KEEP="${RESTORE_DRILL_KEEP:-0}"

mkdir -p "$ROOT/logs" "$WORK_DIR"
log() { echo "[drill-local] $(date '+%F %T') $*" | tee -a "$LOG"; }
cleanup() { [ "$KEEP" = "1" ] || rm -rf "$WORK_DIR"; }
trap 'rc=$?; log "FAILED rc=$rc at line $LINENO"; exit $rc' ERR
trap cleanup EXIT

# 可以用第一个参数指定某个备份文件（例如某个周备）
CANDIDATE="${1:-}"
if [ -z "$CANDIDATE" ]; then
  CANDIDATE=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'mes.db.20*' ! -name '*-wal' -printf '%T@ %p\n' | sort -nr | awk 'NR==1{print $2}')
fi
[ -n "${CANDIDATE:-}" ] && [ -s "$CANDIDATE" ] || { log "ERROR: 没有可用备份"; exit 3; }

log "candidate: $(basename "$CANDIDATE") ($(stat -c %s "$CANDIDATE") bytes)"
cp "$CANDIDATE" "$WORK_DIR/restore.db"
SHA_BACKUP=$(sha256sum "$CANDIDATE" | awk '{print $1}')
SHA_COPY=$(sha256sum "$WORK_DIR/restore.db" | awk '{print $1}')
[ "$SHA_BACKUP" = "$SHA_COPY" ] || { log "ERROR: 副本 sha256 不一致"; exit 4; }
log "sha256 ok: $SHA_COPY"

"$NODE" - "$WORK_DIR/restore.db" "$DB" <<'NODE' 2>&1 | tee -a "$LOG"
const Database = require("/home/dubin/factory-mes/node_modules/better-sqlite3");
const [restoredPath, prodPath] = process.argv.slice(2);
const KEY = ["equipment_instances","work_orders","materials","instance_bom","process_nodes","purchase_orders","audit_logs","users"];
function snap(p) {
  const db = new Database(p, { readonly: true, fileMustExist: true });
  const out = { tables: db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().c,
                integrity: db.pragma("integrity_check", { simple: true }), counts: {} };
  for (const t of KEY) {
    const exists = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name=?").get(t).c;
    out.counts[t] = exists ? db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c : null;
  }
  db.close();
  return out;
}
const restored = snap(restoredPath);
const prod = snap(prodPath);
console.log(JSON.stringify({ restored, prod, newer_than_prod: false }));
const bad = [];
if (restored.integrity !== "ok") bad.push("integrity_check=" + restored.integrity);
if (restored.tables < 100) bad.push("table count too low: " + restored.tables);
for (const t of Object.keys(restored.counts)) {
  const a = restored.counts[t], b = prod.counts[t];
  if (a === null || b === null) continue;
  if (a > b) bad.push(`${t}: 备份 ${a} > 生产 ${b}（备份比生产还新，异常）`);
}
if (bad.length) { console.error("FAIL: " + bad.join("; ")); process.exit(5); }
console.log("OK: 备份可完整恢复（integrity ok / 表数 " + restored.tables + " / 关键表行数不超过生产）");
NODE

log "success db=$(basename "$CANDIDATE") sha256=$SHA_COPY"
