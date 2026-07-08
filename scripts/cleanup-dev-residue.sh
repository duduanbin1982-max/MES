#!/bin/bash
# P2 开发残留清理：只清理可再生成缓存，不动 .nvm/runtime、不动 MES 数据库/上传文件。
set -euo pipefail

LOG="/home/dubin/factory-mes/logs/dev-residue-cleanup.log"
CLEAN_VSCODE_SERVER="${CLEAN_VSCODE_SERVER:-0}"
DRY_RUN="${DRY_RUN:-0}"
mkdir -p "$(dirname "$LOG")"

log() {
  echo "[dev-cleanup] $(date '+%F %T') $*" | tee -a "$LOG"
}

size_of() {
  du -sh "$1" 2>/dev/null | awk '{print $1}' || echo "-"
}

remove_path() {
  local target="$1"
  case "$target" in
    /home/dubin/.cache/*|/home/dubin/.npm/*|/home/dubin/.vscode-server/cli|/home/dubin/.vscode-server/code-*)
      ;;
    *)
      log "SKIP unsafe target: $target"
      return
      ;;
  esac
  if [ ! -e "$target" ]; then
    return
  fi
  local before
  before=$(size_of "$target")
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY remove $target size=$before"
  else
    rm -rf -- "$target"
    log "removed $target size=$before"
  fi
}

log "start dry_run=$DRY_RUN clean_vscode_server=$CLEAN_VSCODE_SERVER"

remove_path "/home/dubin/.npm/_cacache"
remove_path "/home/dubin/.npm/_logs"
remove_path "/home/dubin/.npm/_npx"
remove_path "/home/dubin/.npm/_prebuilds"

remove_path "/home/dubin/.cache/ms-playwright"
remove_path "/home/dubin/.cache/electron"
remove_path "/home/dubin/.cache/uv"
remove_path "/home/dubin/.cache/node-gyp"
remove_path "/home/dubin/.cache/pip"
remove_path "/home/dubin/.cache/node"
remove_path "/home/dubin/.cache/Microsoft"

if [ "$CLEAN_VSCODE_SERVER" = "1" ]; then
  ACTIVE_VSCODE=$(ps -eo pid=,args= | awk '/\/home\/dubin\/\.vscode-server|vscode-server/ && $0 !~ /awk|cleanup-dev-residue/ { print }' || true)
  if [ -n "$ACTIVE_VSCODE" ]; then
    log "skip vscode-server cleanup: active vscode-server process found"
    printf '%s\n' "$ACTIVE_VSCODE" | tee -a "$LOG"
  else
    remove_path "/home/dubin/.vscode-server/cli"
    for old_code in /home/dubin/.vscode-server/code-*; do
      remove_path "$old_code"
    done
  fi
fi

log "done home_cache=$(du -sh /home/dubin/.cache 2>/dev/null | awk '{print $1}') npm=$(du -sh /home/dubin/.npm 2>/dev/null | awk '{print $1}') vscode=$(du -sh /home/dubin/.vscode-server 2>/dev/null | awk '{print $1}')"
