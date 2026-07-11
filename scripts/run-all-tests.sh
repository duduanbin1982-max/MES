#!/bin/bash
# scripts/run-all-tests.sh
# 一键跑全部测试（含 processTree cross-sub 的 seed DB 准备）
set -e
export PATH=/home/dubin/.nvm/versions/node/v22.22.3/bin:$PATH
export PATH=/home/dubin/.nvm/versions/node/v22.22.3/bin:$PATH
cd /home/dubin/factory-mes

echo "=== 0) 检查重复 API 路由 ==="
node scripts/check-duplicate-routes.js

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
run "delayAlerts"            tests/delayAlerts.test.js            ""
run "processParams"           tests/processParams.test.js           ""
run "processMaster"          tests/processMaster.test.js          ""
run "multiInstanceScheduler" tests/multiInstanceScheduler.test.js "export DB_PATH=$SEED_DB"
run "oee"                    tests/oee.test.js                    ""
run "iotLifecycle"            tests/iotLifecycle.test.js            ""
run "iotCollector"            tests/iotCollector.test.js            ""
run "aiModelTraining"         tests/aiModelTraining.test.js         ""
run "keyComponentPrices"      tests/keyComponentPrices.test.js   ""
run "purchase"             tests/purchase.test.js             ""
run "purchaseFollowupTransition" tests/purchaseFollowupTransition.test.js ""
run "materialService"           tests/materialService.test.js           ""
run "costRollup"               tests/costRollup.test.js   ""
run "materialPrices"            tests/materialPrices.test.js   ""
run "processTreeCrossSubDeps(integration)" tests/processTreeCrossSubsystemDeps.integration.test.js "unset DB_PATH"
run "processTreeCrossSubDeps" tests/processTreeCrossSubsystemDeps.test.js "export DB_PATH=$SEED_DB"
run "processTreeMindmap"     tests/processTreeMindmap.test.js     ""
run "scheduler"              tests/scheduler.test.js              ""
run "recomputeSafetyStock"    tests/recompute-safety-stock.test.js ""
run "migrate"                  tests/migrate.test.js                  ""
run "pragmas"                  tests/pragmas.test.js                  ""
run "workflow"                  tests/workflow.test.js               ""
run "errorResponse"         tests/errorResponse.test.js         ""
run "rbac"                        tests/rbac.test.js                  ""
run "roles"                  tests/roles.test.js                  ""
run "bomService"              tests/bomService.test.js              ""
run "documentService"          tests/documentService.test.js       ""
run "ws"                       tests/ws.test.js                    ""
run "audit"                       tests/audit.test.js                 ""
run "systemSettings"              tests/systemSettings.test.js        ""
run "jwt"                         tests/jwt.test.js                   ""
run "sqlInjection"          tests/sqlInjection.test.js          ""

echo "=== 总结: pass=$PASS fail=$FAIL skip=$SKIP ==="
exit $FAIL
