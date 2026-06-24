#!/bin/bash
# scripts/deploy.sh
# 安全部署: 跑测试闸门 -> 失败中止; 通过则滚动重启 (start 备份, 等健康, 再切)
# 用法:
#   bash scripts/deploy.sh                # 完整: 测试 + 重启
#   bash scripts/deploy.sh --test-only    # 只跑测试
#   bash scripts/deploy.sh --no-test      # 跳过测试 (紧急修复, 默认拒绝)
set -uo pipefail

ROOT=/home/dubin/factory-mes
SVC=factory-mes.service
ALLOW_NO_TEST=0
TEST_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --test-only) TEST_ONLY=1 ;;
    --no-test) ALLOW_NO_TEST=1 ;;
  esac
done

echo "=========================================="
echo " factory-mes 安全部署"
echo " 时间: $(date -Iseconds)"
echo "=========================================="

# 闸门
if [ "$ALLOW_NO_TEST" = "1" ]; then
  echo "⚠️  --no-test: 跳过测试闸门 (紧急模式)"
else
  echo "[1/3] 跑测试闸门 ..."
  if ! bash "$ROOT/scripts/pre-deploy-test.sh"; then
    echo "❌ 测试失败, 部署中止. 查看日志: $ROOT/data/predeploy-*.log"
    exit 1
  fi
fi

if [ "$TEST_ONLY" = "1" ]; then
  echo "✅ --test-only: 闸门通过, 不重启"
  exit 0
fi

# 滚动重启
echo "[2/3] 重启 $SVC ..."
systemctl --user restart "$SVC"
sleep 2
ACTIVE=$(systemctl --user is-active "$SVC")
echo "  状态: $ACTIVE"

if [ "$ACTIVE" != "active" ]; then
  echo "❌ 启动失败, 查看日志: journalctl --user -u $SVC -n 30"
  exit 1
fi

# 健康
echo "[3/3] 健康检查 ..."
HEALTH=$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3890/api/health)
if [ "$HEALTH" != "200" ]; then
  echo "❌ /api/health 返回 $HEALTH"
  exit 1
fi
echo "  /api/health: $HEALTH"

PID=$(systemctl --user show -p MainPID --value "$SVC")
echo "=========================================="
echo " ✅ 部署成功, PID=$PID"
echo "=========================================="