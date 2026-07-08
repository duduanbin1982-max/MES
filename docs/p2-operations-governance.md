# P2 运行治理

P2 解决三个“生产运维可持续性”问题：

1. 日志治理：扩展 `factory-mes-logrotate.conf`，覆盖 `data/mes.log`、`data/feishu_queue.log`、`logs/*.log`、`backups/cron.log`。
2. 恢复演练：`scripts/restore-drill.sh` 从 `192.168.1.75` 离机备份拉取最新 DB 到 `/tmp`，校验 sha256、SQLite `integrity_check` 和核心表计数，不覆盖生产库。
3. 开发残留清理：`scripts/cleanup-dev-residue.sh` 清理 `.cache`、`.npm` 和可选 `.vscode-server` 缓存，不动 `.nvm`、数据库、上传文件。

## 手动命令

```bash
cd /home/dubin/factory-mes
bash scripts/restore-drill.sh
DRY_RUN=1 CLEAN_VSCODE_SERVER=1 bash scripts/cleanup-dev-residue.sh
CLEAN_VSCODE_SERVER=1 bash scripts/cleanup-dev-residue.sh
```

## 定时任务建议

恢复演练可每周日凌晨执行一次：

```cron
45 3 * * 0 /home/dubin/factory-mes/scripts/restore-drill.sh
```

## 2026-07-08 磁盘扩容记录

`192.168.1.73` 已完成在线扩容：

- 虚拟磁盘：`/dev/sda` 保持 `200G`
- LVM 分区：`/dev/sda3` 从约 `46.9G` 扩到约 `196.9G`
- 根 LV：`/dev/ubuntu-vg/ubuntu-lv` 从 `23.47G` 扩到 `80G`
- 根文件系统：`ext4` 在线 resize 成功
- 扩容后 `/`：约 `79G`，可用约 `61G`，使用率约 `20%`
- VG 剩余空闲：约 `116.95G`，后续仍可继续在线扩容

验证项：

- `systemctl --user is-active factory-mes.service` 返回 `active`
- `GET /api/health` 返回 `ok`
- `backup-db.sh` / `offsite-backup.sh` / `restore-drill.sh` / `cleanup-dev-residue.sh` 语法检查通过

