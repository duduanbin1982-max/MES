#!/bin/bash
# scripts/restore-drill-offsite.sh
# 异地副本恢复演练 —— 2026-10-16 新增（批次四 · D 项）
#
# 【为什么需要它】
#   此前的验证覆盖了两件事：
#     · restore-drill-local.sh   → 证明「本地备份」可恢复
#     · offsite-backup.sh 的验收 → 证明「传输那一瞬间」sha256 一致
#   但都回答不了一个问题：**NAS 上那份副本，现在还能不能真的恢复？**
#   静默损坏（位翻转、卷异常、保留策略误删、单文件被别的东西覆盖）不在任何
#   既有检查的视野内 —— 因为没人回头去读过它。本脚本就是那个「回头读」的人。
#
# 【三层校验，逐层收紧】
#   ① NAS 端完整性：在 NAS 上重新计算目标文件的 sha256，与 manifest 记录值比对
#        → 证明「存放中的副本」没有变质
#   ② 传输保真：取回后在本地重算 sha256，与同一 manifest 值比对
#        → 证明「取回过程」（rsync/网络）没有失真
#   ③ 可恢复性：对取回的库跑 integrity_check + 表数 + 关键表行数比对生产库
#        → 证明「这份文件确实是一份可用的数据库」，而不只是一串长度对的字节
#
# 【只读承诺】不写 NAS、不覆盖生产库、不修改任何配置；临时目录用完即删。
#
# 【口径一致性】③ 的表清单与判定标准与 restore-drill-local.sh 保持一致，
#   两者若需调整必须同时改（见该脚本同名 KEY 数组）。
#
# 【实现注记 · 踩过的坑】bash 的 ERR trap 与 `set -e` 是【独立】的两件事：
#   即使 `set +e`，命令返回非零仍会触发 ERR trap（进而 exit），拿不到自定义诊断。
#   要抑制必须让命令处于 `||` 或 `if/while` 条件上下文。
#   本脚本所有「可能失败且需要给出诊断」的远程/传输调用均采用该写法。
#
# 用法：
#   bash scripts/restore-drill-offsite.sh
# 环境变量（缺省即 cron 中使用的生产值）：
#   OFFSITE_USER / OFFSITE_HOST / OFFSITE_ROOT / OFFSITE_KEY / OFFSITE_RSYNC_PATH
#   OFFSITE_DRILL_KEEP=1 保留临时目录（排查用）
set -euo pipefail

ROOT="/home/dubin/factory-mes"
NODE="/home/dubin/.nvm/versions/node/v22.22.3/bin/node"
LOG="$ROOT/logs/restore-drill-offsite.log"
DB="$ROOT/data/mes.db"
RUN_ID=$(date +%Y%m%d_%H%M%S)
WORK_DIR="${OFFSITE_DRILL_WORK_DIR:-/tmp/mes-offsite-drill-$RUN_ID}"
KEEP="${OFFSITE_DRILL_KEEP:-0}"

OFFSITE_USER="${OFFSITE_USER:-tbmmes}"
OFFSITE_HOST="${OFFSITE_HOST:-192.168.1.10}"
OFFSITE_ROOT="${OFFSITE_ROOT:-/volume2/mes-backup/192.168.1.73}"
OFFSITE_KEY="${OFFSITE_KEY:-/home/dubin/.ssh/factory_mes_offsite_ed25519}"
OFFSITE_RSYNC_PATH="${OFFSITE_RSYNC_PATH:-}"

SSH_OPTS=(-i "$OFFSITE_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
RSYNC_SSH="ssh -i $OFFSITE_KEY -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"
RSYNC_PATH_OPT=()
if [ -n "$OFFSITE_RSYNC_PATH" ]; then
  RSYNC_PATH_OPT=(--rsync-path="$OFFSITE_RSYNC_PATH")
fi

mkdir -p "$ROOT/logs" "$WORK_DIR"
log() { echo "[drill-offsite] $(date '+%F %T') $*" | tee -a "$LOG"; }
cleanup() { [ "$KEEP" = "1" ] || rm -rf "$WORK_DIR"; }
trap 'rc=$?; log "FAILED rc=$rc at line $LINENO"; exit $rc' ERR
trap cleanup EXIT

REMOTE="$OFFSITE_USER@$OFFSITE_HOST"

if [ ! -f "$OFFSITE_KEY" ]; then
  log "ERROR: ssh key not found: $OFFSITE_KEY"
  exit 2
fi

# ---- 1) 取回最新 manifest ------------------------------------------------
MANIFEST_LOCAL="$WORK_DIR/manifest.json"
LATEST_MANIFEST=""
if ! LATEST_MANIFEST=$(ssh "${SSH_OPTS[@]}" "$REMOTE" \
      "ls -t '$OFFSITE_ROOT/manifests'/manifest-*.json 2>/dev/null | head -1" 2>"$WORK_DIR/ssh.err"); then
  log "ERROR: 无法列出远端 manifest（NAS 不可达 / 密钥失效 / 路径不存在？）"
  [ -s "$WORK_DIR/ssh.err" ] && sed 's/^/       /' "$WORK_DIR/ssh.err" | tee -a "$LOG"
  exit 3
fi
if [ -z "${LATEST_MANIFEST:-}" ]; then
  log "ERROR: 远端 $OFFSITE_ROOT/manifests/ 下没有任何 manifest"
  exit 3
fi
if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "cat '$LATEST_MANIFEST'" > "$MANIFEST_LOCAL" 2>"$WORK_DIR/ssh.err"; then
  log "ERROR: manifest 拉取失败: $LATEST_MANIFEST"
  [ -s "$WORK_DIR/ssh.err" ] && sed 's/^/       /' "$WORK_DIR/ssh.err" | tee -a "$LOG"
  exit 3
fi
[ -s "$MANIFEST_LOCAL" ] || { log "ERROR: manifest 内容为空: $LATEST_MANIFEST"; exit 3; }

# 远端无 jq，用 grep/sed 解析（manifest 由本仓库 offsite-backup.sh 生成，字段名稳定）
pick() { grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$MANIFEST_LOCAL" | sed 's/.*"\([^"]*\)"$/\1/'; }
BACKUP_NAME=$(pick latest_db_backup)
EXPECT_SHA=$(pick latest_db_sha256)
MANIFEST_ID=$(pick run_id)
[ -n "$BACKUP_NAME" ] || { log "ERROR: manifest 缺 latest_db_backup"; exit 3; }
[ -n "$EXPECT_SHA" ]  || { log "ERROR: manifest 缺 latest_db_sha256"; exit 3; }
log "manifest: $(basename "$LATEST_MANIFEST") run_id=$MANIFEST_ID → 目标副本 $BACKUP_NAME"

# ---- 2) ① NAS 端完整性 ---------------------------------------------------
REMOTE_SHA=""
if ! ssh "${SSH_OPTS[@]}" "$REMOTE" \
      "sha256sum '$OFFSITE_ROOT/daily/$BACKUP_NAME' 2>/dev/null | awk '{print \$1}'" \
      > "$WORK_DIR/remote.sha" 2>"$WORK_DIR/ssh.err"; then
  log "ERROR: 远端 sha256 计算失败（ssh 层面）"
  [ -s "$WORK_DIR/ssh.err" ] && sed 's/^/       /' "$WORK_DIR/ssh.err" | tee -a "$LOG"
  exit 4
fi
REMOTE_SHA=$(tr -d ' \n\r' < "$WORK_DIR/remote.sha")
if [ -z "$REMOTE_SHA" ]; then
  log "ERROR: 远端 $OFFSITE_ROOT/daily/$BACKUP_NAME 读不到，或 NAS 上无 sha256sum"
  exit 4
fi
if [ "$REMOTE_SHA" != "$EXPECT_SHA" ]; then
  log "ERROR: NAS 端 sha256 与 manifest 不符 —— 存放中的副本已损坏"
  log "       remote=$REMOTE_SHA"
  log "       expect=$EXPECT_SHA"
  exit 4
fi
log "① NAS 端完整性 ok: $REMOTE_SHA"

# ---- 3) ② 取回并验传输保真 ----------------------------------------------
# `|| RSYNC_RC=$?` 既是取原始退出码，也是抑制 ERR trap 的必要写法（见文件头注记）
RSYNC_RC=0
rsync -a "${RSYNC_PATH_OPT[@]}" -e "$RSYNC_SSH" \
  "$REMOTE:$OFFSITE_ROOT/daily/$BACKUP_NAME" "$WORK_DIR/restore.db" 2>"$WORK_DIR/rsync.err" || RSYNC_RC=$?
if [ "$RSYNC_RC" -ne 0 ]; then
  log "ERROR: rsync 取回失败 rc=$RSYNC_RC"
  [ -s "$WORK_DIR/rsync.err" ] && sed 's/^/       /' "$WORK_DIR/rsync.err" | tee -a "$LOG"
  if [ -z "$OFFSITE_RSYNC_PATH" ]; then
    log "       疑似原因: 未设置 OFFSITE_RSYNC_PATH。若目标是 Synology NAS，其自带"
    log "       /usr/bin/rsync 带 setuid root 位，非 root 经 SSH 调用无法完成真实数据传输"
    log "       （远端回一条认证提示语、退出码 1；本地 rsync 报 rc=12，易误判为认证问题）。"
    log "       解决: 传 OFFSITE_RSYNC_PATH=<NAS 家目录下的同版本非 setuid 副本>"
  fi
  exit 5
fi
LOCAL_SHA=$(sha256sum "$WORK_DIR/restore.db" | awk '{print $1}')
if [ "$LOCAL_SHA" != "$EXPECT_SHA" ]; then
  log "ERROR: 取回后 sha256 不一致 —— 传输失真"
  log "       local =$LOCAL_SHA"
  log "       expect=$EXPECT_SHA"
  exit 5
fi
GOT_SIZE=$(stat -c %s "$WORK_DIR/restore.db")
log "② 传输保真 ok: $LOCAL_SHA (${GOT_SIZE} bytes)"

# ---- 4) ③ 可恢复性（口径与 restore-drill-local.sh 一致）-----------------
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
const bad = [];
if (restored.integrity !== "ok") bad.push("integrity_check=" + restored.integrity);
if (restored.tables < 100) bad.push("table count too low: " + restored.tables);
for (const t of Object.keys(restored.counts)) {
  const a = restored.counts[t], b = prod.counts[t];
  if (a === null || b === null) continue;
  if (a > b) bad.push(`${t}: 异地副本 ${a} > 生产 ${b}（副本比生产还新，异常）`);
}
if (bad.length) { console.error("FAIL: " + bad.join("; ")); process.exit(6); }
console.log(`OK: 异地副本可完整恢复（integrity ok / 表数 ${restored.tables} / 关键表行数不超过生产）`);
NODE

# ---- 5) 收尾 -------------------------------------------------------------
log "success origin=$BACKUP_NAME size=${GOT_SIZE} sha256=$LOCAL_SHA manifest=$MANIFEST_ID"
