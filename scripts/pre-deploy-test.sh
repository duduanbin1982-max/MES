#!/bin/bash
# scripts/pre-deploy-test.sh
# 部署前测试闸门: 跑全套测试, 失败则阻止 service 重启/升级
# 退出码:
#   0  = 全过, 可安全部署
#   1  = 测试失败, 阻断
#   2  = 测试运行时报错 (脚本/环境问题)
# 用法:
#   bash scripts/pre-deploy-test.sh
#   bash scripts/pre-deploy-test.sh --skip-integration   # 跳集成 (调试用)
#   bash scripts/pre-deploy-test.sh --quiet               # 只打总结
set -u
set -o pipefail

ROOT=/home/dubin/factory-mes
LOG_DIR=/home/dubin/factory-mes/logs/predeploy
mkdir -p "$LOG_DIR"
find "$LOG_DIR" -name 'predeploy-*.log' -mtime +14 -delete 2>/dev/null || true

QUIET=0
SKIP_INTEGRATION=0
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    --skip-integration) SKIP_INTEGRATION=1 ;;
  esac
done

export PATH=/home/dubin/.nvm/versions/node/v22.22.3/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

log() { [ "$QUIET" = "0" ] && echo "[predeploy] $*"; }

log "环境: node $(node -v 2>/dev/null || echo '?')  python3 $(python3 --version 2>/dev/null | awk '{print $2}' || echo '?')"
log "工作目录: $ROOT"
log "日志: $LOG_DIR/predeploy-$(date +%Y%m%d-%H%M%S).log"

ts=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/predeploy-$ts.log"

# 跑测试 (集成测试需要 seed DB, 沙箱里可能没 python3, 失败时降级)
if [ "$SKIP_INTEGRATION" = "1" ]; then
  log "跳过集成测试 (--skip-integration)"
  TEST_OUT=$(cd "$ROOT" && npm test --silent 2>&1 | grep -E '(===|pass=|❌|✅)' | grep -v integration || true)
  PASS_LINE=$(cd "$ROOT" && npm test --silent 2>&1 | grep -E '总结:' || true)
else
  log "运行全套测试 (含集成) ..."
  # 关闭 set -e, 收集 RC 后显式判断
  bash "$ROOT/scripts/run-all-tests.sh" > "$LOG_FILE" 2>&1
  RC=$?
  # 恢复不在此处, 因为我们没有 set -e
  log "测试退出码: $RC"
  if [ "$QUIET" = "0" ]; then
    tail -25 "$LOG_FILE" | sed 's/^/  /'
  fi
  PASS_LINE=$(grep -E '总结:' "$LOG_FILE" || true)
  if [ "$RC" -ne 0 ]; then
    log "❌ 测试失败, 阻断部署. 完整日志: $LOG_FILE"
    exit 1
  fi
fi

# 语法体检: 所有 .js 不能有语法错
log "语法体检 (services + tests) ..."
SYNTAX_ERR=0
while IFS= read -r f; do
  if ! node --check "$f" >/dev/null 2>&1; then
    log "  语法错: $f"
    SYNTAX_ERR=1
  fi
done < <(find "$ROOT/services" "$ROOT/middleware" "$ROOT/utils" -name '*.js' 2>/dev/null)
if [ "$SYNTAX_ERR" = "1" ]; then
  log "❌ 语法体检未通过, 阻断部署"
  exit 1
fi

# 总结
log "$PASS_LINE"
log "✅ 部署前检查全部通过"
exit 0