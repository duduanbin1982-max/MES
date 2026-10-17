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
# 清理 predeploy 日志目录 —— 2026-10-16 批次四 C 项
# 原实现 `find "$LOG_DIR" -name 'predeploy-*.log' -mtime +3 -delete` 有三个缺陷：
#   ① 只匹配 predeploy-*.log，漏掉 frontend-domain-*.log
#   ② 只匹配 .log，漏掉全部轮转产物 .log.1.gz / .log.2.gz ...
#   ③ 只在「恰好发生了一次发布」时才执行 —— 不发布就永不清理
# 现改为调用统一清理脚本：按 mtime 覆盖目录内全部日志与 0 字节空壳，保留期 14 天，
# 并由 cron 每日兜底（不再依赖发布动作触发）。
if [ -f "$ROOT/scripts/logs-predeploy-cleanup.sh" ]; then
  bash "$ROOT/scripts/logs-predeploy-cleanup.sh" >/dev/null 2>&1 || true
fi
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

# P1-4: 跑测试前 cp 生产 db 到临时 db, 避免测试写库
TEST_DB=""
if [ -f "$ROOT/data/mes.db" ]; then
  TEST_DB="/tmp/factory-mes-predeploy-test-$(date +%Y%m%d_%H%M%S).db"
  if cp "$ROOT/data/mes.db" "$TEST_DB" 2>/dev/null; then
    export DB_PATH="$TEST_DB"
    trap 'rm -f "$TEST_DB"' EXIT
    log "测试用临时 db: $TEST_DB"
  else
    log "复制生产 db 失败, 回退用生产 db (有污染风险)"
    TEST_DB=""
  fi
fi

log "环境: node $(node -v 2>/dev/null || echo '?')  python3 $(python3 --version 2>/dev/null | awk '{print $2}' || echo '?')"
log "工作目录: $ROOT"
log "日志: $LOG_DIR/predeploy-$(date +%Y%m%d-%H%M%S).log"

ts=$(date +%Y%m%d_%H%M%S)
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

# ESLint 静态检查 —— 2026-10-17 落地（方案 W3-5）
# 规则见 eslint.config.js：error 级阻断部署；warn 级（存量 no-unused-vars）只提示不阻断
if [ -x "$ROOT/node_modules/.bin/eslint" ]; then
  log "ESLint 静态检查 ..."
  ESLINT_LOG="$LOG_DIR/eslint-$ts.log"
  if (cd "$ROOT" && "$ROOT/node_modules/.bin/eslint" . --max-warnings 0 ) > "$ESLINT_LOG" 2>&1; then
    ERR_CNT=$(grep -cE '^✖|error' "$ESLINT_LOG" 2>/dev/null || echo 0)
    WARN_CNT=$(grep -oE '[0-9]+ warning' "$ESLINT_LOG" 2>/dev/null | tail -1 | awk '{print $1}' || true)
    log "  ESLint: 0 error / 0 warning（任何新增问题都会阻断，棘轮已收口）"
  else
    log "  ❌ ESLint 有 error，阻断部署。前 10 条:"
    grep -E '^/|  [0-9]+:[0-9]+' "$ESLINT_LOG" | head -20 | sed 's/^/  /'
    log "  完整日志: $ESLINT_LOG"
    exit 1
  fi
else
  log "  跳过 ESLint（node_modules/.bin/eslint 不存在，先 npm ci）"
fi

# 前端 ESLint（Vue 3 + TS）—— 2026-10-17 落地（eslint-plugin-vue + typescript-eslint）
# error 阻断部署；warning（存量 vue/no-mutating-props 等）只提示，棘轮见 docs/lint-and-ci.md
if [ -x "$ROOT/frontend/node_modules/.bin/eslint" ]; then
  log "前端 ESLint 静态检查 ..."
  FE_LINT_LOG="$LOG_DIR/frontend-eslint-$ts.log"
  if (cd "$ROOT/frontend" && "$ROOT/frontend/node_modules/.bin/eslint" . --max-warnings 0 ) > "$FE_LINT_LOG" 2>&1; then
    FE_WARN=$(grep -oE '[0-9]+ warning' "$FE_LINT_LOG" 2>/dev/null | tail -1 | awk '{print $1}' || true)
    log "  前端 ESLint: 0 error / 0 warning（棘轮已收口，任何新增问题都会阻断）"
  else
    log "  ❌ 前端 ESLint 有 error，阻断部署。前 10 条:"
    grep -E '^/|  [0-9]+:[0-9]+' "$FE_LINT_LOG" | head -16 | sed 's/^/  /'
    log "  完整日志: $FE_LINT_LOG"
    exit 1
  fi
else
  log "  跳过前端 ESLint（frontend/node_modules/.bin/eslint 不存在）"
fi

# 前端模板编译检查（2026-10-17 新增）
# 背景：`vue-tsc` 不报"v-model 绑定在 prop 上"这类模板编译错误，只有 vite build 才会暴露；
# 而 dist 是发布时单独构建的，等到发布才发现就太晚了。这里把构建产物写到 /tmp（不动 dist）。
if [ -x "$ROOT/frontend/node_modules/.bin/vite" ]; then
  log "前端模板编译检查 (vite build → /tmp) ..."
  FE_BUILD_LOG="$LOG_DIR/frontend-build-$ts.log"
  FE_OUT="/tmp/factory-mes-fe-build-$ts"
  if (cd "$ROOT/frontend" && "$ROOT/frontend/node_modules/.bin/vite" build --outDir "$FE_OUT" --emptyOutDir --logLevel error) > "$FE_BUILD_LOG" 2>&1; then
    rm -rf "$FE_OUT"
    log "  前端构建: ok"
  else
    log "  ❌ 前端模板编译失败，阻断部署。错误摘要:"
    grep -E "error|SyntaxError|v-model|at .*vue" "$FE_BUILD_LOG" | head -12 | sed 's/^/  /'
    log "  完整日志: $FE_BUILD_LOG"
    exit 1
  fi
else
  log "  跳过前端模板编译检查（frontend/node_modules/.bin/vite 不存在）"
fi

# 前端 domain 层单测 (无浏览器: Node 22 原生 TS 类型擦除 + node:test)
if [ -d "$ROOT/frontend/node_modules" ]; then
  log "前端 domain 单测 (frontend/tests/domain) ..."
  FE_LOG="$LOG_DIR/frontend-domain-$ts.log"
  if (cd "$ROOT/frontend" && node --test tests/domain/*.test.ts) > "$FE_LOG" 2>&1; then
    FE_PASS=$(grep -E '^# pass ' "$FE_LOG" | awk '{print $3}' || echo "?")
    log "  前端 domain: ${FE_PASS}/${FE_PASS} ✅"
  else
    log "  ❌ 前端 domain 单测失败, 阻断部署. 完整日志: $FE_LOG"
    grep -E '^(not ok|  error)' "$FE_LOG" | head -10 | sed 's/^/  /'
    exit 1
  fi
else
  log "  跳过前端 domain 单测 (frontend/node_modules 不存在)"
fi

# 总结
log "$PASS_LINE"
log "✅ 部署前检查全部通过"
exit 0
