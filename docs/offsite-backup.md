# 离机备份方案

P0-3 使用 `192.168.1.75` 作为 `192.168.1.73` TBM-MES 的离机备份点。

## 备份内容

- 最新 SQLite 备份：`backups/mes.db.*`
- 周备份：`backups/weekly/`
- 上传图纸/文档：`data/uploads/`
- 恢复配置快照：`.env`、`factory-mes.service`、`nginx/factory-mes.conf`、关键脚本和文档
- Manifest：git commit、tag、DB 文件 sha256、上传文件数量、核心表计数

## 备份目标

```text
dubin@192.168.1.75:/home/dubin/mes-offsite-backups/192.168.1.73
```

## 定时任务

`192.168.1.73` 用户级 crontab：

```bash
30 3 * * * /home/dubin/factory-mes/scripts/offsite-backup.sh
```

本地备份 `backup-db.sh` 在 03:00 执行，离机备份在 03:30 执行。

## 保留策略

- Daily DB：30 天
- Weekly DB：90 天
- Config snapshot：30 天
- Manifest：30 天

## 手动执行

```bash
cd /home/dubin/factory-mes
bash scripts/offsite-backup.sh
tail -50 logs/offsite-backup.log
```

## 恢复校验

```bash
ssh dubin@192.168.1.75 'ls -lh /home/dubin/mes-offsite-backups/192.168.1.73/daily | tail'
ssh dubin@192.168.1.75 'cat /home/dubin/mes-offsite-backups/192.168.1.73/manifests/manifest-*.json | tail'
```

恢复时优先选择 manifest 中 sha256 校验一致的最新 DB 备份。
