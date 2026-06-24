#!/bin/bash
# reset-to-demo.sh
# 一键把 .73 上的 TBM-MES 重置到演示状态
# 适用场景: 重新演示 / 出问题想重置 / 学习用
# ⚠️ 警告: 会清空所有业务数据！系统配置（用户/角色/9 子系统/工位/设备/TBM 型号）保留

set -e

REMOTE="dubin@192.168.1.73"
NODE_PATH="/home/dubin/.nvm/versions/node/v22.22.3/bin/node"
APP_DIR="/home/dubin/factory-mes"
BACKUP_DIR="/home/dubin/factory-mes-reset-backups"

echo "=== TBM-MES 一键重置到演示状态 ==="
echo ""
echo "⚠️  将清空:"
echo "   - 所有项目 + 里程碑 + BOM + 工单 + 焊接/探伤/装配记录"
echo "   - 所有物料 + 关键外购件"
echo "   - 所有现场服务 + 设计变更 + 出厂资料 + 质量反馈"
echo ""
echo "✓ 保留:"
echo "   - 用户 / 角色 / 9 大子系统字典 / TBM 型号 / 工位 / 设备"
echo ""
read -p "确认重置? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "已取消"
  exit 0
fi

# 1) 备份当前 DB
echo ""
echo "[1/3] 备份当前 DB..."
mkdir -p "$BACKUP_DIR"
ssh $REMOTE "mkdir -p $BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ssh $REMOTE "cp -av $APP_DIR/data/ $BACKUP_DIR/data_$TIMESTAMP/" | tail -3

# 2) 停 service + 清业务数据 + 重建示例项目
echo ""
echo "[2/3] 停 service + 清数据 + 重建..."
ssh $REMOTE << REMOTE_EOF
set -e
cd $APP_DIR

# 停 service
systemctl --user stop factory-mes.service
sleep 1

# 清业务数据（保留主数据：tbm_subsystems, tbm_models, users, roles, workstations, equipment）
$NODE_PATH -e "
const db = require('./db');
const t = db.transaction(() => {
  db.prepare('DELETE FROM project_bom').run();
  db.prepare('DELETE FROM project_milestones').run();
  db.prepare('DELETE FROM work_orders').run();
  db.prepare('DELETE FROM work_order_operations').run();
  db.prepare('DELETE FROM work_order_qc').run();
  db.prepare('DELETE FROM weld_records').run();
  db.prepare('DELETE FROM ndt_records').run();
  db.prepare('DELETE FROM assembly_records').run();
  db.prepare('DELETE FROM materials').run();
  db.prepare('DELETE FROM key_components').run();
  db.prepare('DELETE FROM material_lots').run();
  db.prepare('DELETE FROM inventory').run();
  db.prepare('DELETE FROM qc_inspections').run();
  db.prepare('DELETE FROM documents').run();
  db.prepare('DELETE FROM field_service').run();
  db.prepare('DELETE FROM feedback').run();
  db.prepare('DELETE FROM project_eco').run();
  db.prepare('DELETE FROM project_specs').run();
  db.prepare('DELETE FROM projects').run();
  db.prepare(\"DELETE FROM sqlite_sequence\").run();
});
t();
console.log('✓ 业务数据已清空');
"

# 重建示例项目 + BOM
$NODE_PATH seed-demo.js

# 启动
systemctl --user start factory-mes.service
sleep 1
systemctl --user is-active factory-mes.service
REMOTE_EOF

# 3) 验证
echo ""
echo "[3/3] 验证..."
sleep 2
echo ""
echo "=== Health ==="
curl -s http://192.168.1.73:3890/api/health
echo ""
echo ""
echo "=== Dashboard ==="
curl -s http://192.168.1.73:3890/api/dashboard
echo ""
echo ""
echo "✅ 重置完成！示例项目 TBM-2026-001 已就绪（Ø4m 土压平衡，9 子系统 BOM）"
echo ""
echo "备份位置: $REMOTE:$BACKUP_DIR/data_$TIMESTAMP"
echo "试一下:   curl http://192.168.1.73:3890/api/projects/1/dashboard"
