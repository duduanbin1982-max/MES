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
