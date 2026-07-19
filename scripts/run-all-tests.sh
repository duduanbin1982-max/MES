#!/bin/bash
# scripts/run-all-tests.sh
# 一键跑全部测试（含 processTree cross-sub 的 seed DB 准备）
set -e
export PATH=/home/dubin/.nvm/versions/node/v22.22.3/bin:$PATH

# 2026-07-11 Hermes brooks-test T5 修复: JWT_SECRET 全局可用
# 所有加载 app/jwt 的测试都需要 JWT_SECRET (>= 32 字符)
# .env 应该已经提供, 但 .env 缺失时 fallback 到 dev key
if [ -z "${JWT_SECRET:-}" ]; then
  export JWT_SECRET=$(node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))')
fi

cd /home/dubin/factory-mes

echo "=== 0) 检查重复 API 路由 ==="
node scripts/check-duplicate-routes.js

echo "=== 0.1) 检查模块清单/菜单/路由一致性 ==="
node scripts/check-module-manifest.js

echo "=== 1) 准备 cross-sub seed DB ==="
node tests/_seedXsubDb.js > /tmp/seed-xsub.json
SEED_DB=$(python3 -c "import json; print(json.load(open('/tmp/seed-xsub.json'))['DB_PATH'])")
echo "SEED_DB=$SEED_DB"

PASS=0; FAIL=0; SKIP=0
run() {
  local label="$1"; local test_file="$2"; local pre_cmd="$3"
  if [ -n "$pre_cmd" ]; then eval "$pre_cmd"; fi
  local out
  set +e
  out=$(node "$test_file" 2>&1)
  local code=$?
  set -e
  local p f
  p=$(echo "$out" | grep -E "^# pass " | awk '{print $3}')
  f=$(echo "$out" | grep -E "^# fail " | awk '{print $3}')
  if [ -z "$p" ]; then
    p=$(echo "$out" | grep -E "^passed:" | awk '{print $2}')
    f=$(echo "$out" | grep -E "^passed:" | awk '{print $4}')
  fi
  if [ -z "$p" ]; then
    if [ "$code" != "0" ]; then
      echo "  $label: command failed before TAP ❌"
      FAIL=$((FAIL+1))
      echo "$out" | head -20
      return
    fi
    echo "  $label: (no node:test output) skip"
    SKIP=$((SKIP+1))
    return
  fi
  if [ "$f" = "0" ]; then
    echo "  $label: $p/$p ✅"
    PASS=$((PASS+p))
  else
    echo "  $label: $p pass, $f fail ❌"
    FAIL=$((FAIL+f))
    echo "$out" | grep -E "^(not ok|  error)" | head -5
  fi
}

echo "=== 2) 跑全部测试 ==="
declare -A TEST_PRE_COMMANDS=(
  ["tests/multiInstanceScheduler.test.js"]="export DB_PATH=$SEED_DB"
  ["tests/processTreeCrossSubsystemDeps.test.js"]="export DB_PATH=$SEED_DB"
  ["tests/processTreeCrossSubsystemDeps.integration.test.js"]="unset DB_PATH"
)

while IFS= read -r test_file; do
  label=$(basename "$test_file" .test.js)
  run "$label" "$test_file" "${TEST_PRE_COMMANDS[$test_file]:-}"
done < <(find tests -maxdepth 1 -type f -name '*.test.js' -print | sort)

echo "=== 总结: pass=$PASS fail=$FAIL skip=$SKIP ==="
exit $FAIL
