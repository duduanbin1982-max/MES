#!/usr/bin/env bash
# scripts/install-acceptance-timer.sh
# 2026-11-05：安装「每日端到端健康检查」systemd user timer。
#
# 做的事：
#   1. 把 deploy/systemd/factory-mes-acceptance.{service,timer} 拷到 ~/.config/systemd/user/
#   2. daemon-reload + enable --now timer
#   3. 打印下一次触发时间与最近一次结果
#
# 用法：
#   bash scripts/install-acceptance-timer.sh            # 安装并启用
#   bash scripts/install-acceptance-timer.sh --run-now  # 安装后立刻跑一次
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
SRC_DIR="$ROOT/deploy/systemd"

mkdir -p "$UNIT_DIR"
install -m 0644 "$SRC_DIR/factory-mes-acceptance.service" "$UNIT_DIR/factory-mes-acceptance.service"
install -m 0644 "$SRC_DIR/factory-mes-acceptance.timer" "$UNIT_DIR/factory-mes-acceptance.timer"

systemctl --user daemon-reload
systemctl --user enable --now factory-mes-acceptance.timer

echo "已安装：factory-mes-acceptance.timer"
systemctl --user list-timers factory-mes-acceptance.timer --no-pager || true

if [[ "${1:-}" == "--run-now" ]]; then
  echo "立即执行一次健康检查…"
  systemctl --user start factory-mes-acceptance.service
  sleep 1
  systemctl --user status factory-mes-acceptance.service --no-pager --lines=20 || true
  echo
  echo "最近一次结果："
  cat "$ROOT/logs/acceptance/latest.status" 2>/dev/null || echo "（尚无报告，首次运行可能仍在进行）"
else
  echo "如需立刻跑一次：bash scripts/install-acceptance-timer.sh --run-now"
fi
