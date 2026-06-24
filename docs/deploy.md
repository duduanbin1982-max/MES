# 部署手册 (Deploy Guide)

从裸机到 factory-mes 跑起来, 涵盖: 系统依赖、初始部署、配置、升级、回滚、备份、监控.

## 部署架构

```
┌────────────────────────────────────────────────────┐
│  客户端 (浏览器 / curl / API 调用方)                │
└───────────────────┬────────────────────────────────┘
                    │ HTTPS
                    ▼
┌────────────────────────────────────────────────────┐
│  nginx (192.168.1.73:443)                          │
│  - TLS 终止 (self-signed cert in ssl/)             │
│  - 反代到 127.0.0.1:3890                            │
│  - 静态资源缓存                                     │
└───────────────────┬────────────────────────────────┘
                    │ HTTP
                    ▼
┌────────────────────────────────────────────────────┐
│  factory-mes (systemd --user)                       │
│  - node v22.22.3 (nvm 装在 /home/dubin/.nvm)         │
│  - server.js 监听 127.0.0.1:3890 (绑本机回环)        │
│  - 数据: data/mes.db (WAL 模式)                     │
│  - 日志: data/mes.log (systemd append)              │
└───────────────────┬────────────────────────────────┘
                    │ better-sqlite3
                    ▼
┌────────────────────────────────────────────────────┐
│  SQLite (data/mes.db)                               │
│  - 28 张表 (migrations 001-017)                     │
│  - WAL journal mode, synchronous=NORMAL             │
└────────────────────────────────────────────────────┘
```

## 系统要求

| 组件 | 版本 | 说明 |
|---|---|---|
| OS | Ubuntu 22.04+ | 任何 systemd + node 22 都行, 但 nginx/SSL 示例按 Ubuntu |
| Node.js | 22.x | 推荐用 nvm 装 (PATH 需含 nvm bin) |
| Python3 | 3.10+ | 集成测试需要 (cross-sub seed DB) |
| SQLite | 3.35+ | WAL 模式 + foreign_keys 需要 |
| nginx | 1.18+ | 反代, TLS 终止 |
| systemd | 245+ | user 模式 (不开 linger 也能跑) |

## 一次性初始部署

### 1. 系统包

```bash
sudo apt update
sudo apt install -y nodejs npm python3 python3-pip sqlite3 nginx certbot
# 推荐: 卸掉系统 nodejs, 改用 nvm 装 node 22 (与 factory-mes 开发环境一致)
```

### 2. Node 22 (用 nvm)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
# 验证
node -v   # v22.22.3+
which node  # /home/<user>/.nvm/versions/node/v22.22.3/bin/node
```

### 3. 拉代码

```bash
# 方式 A: git clone (推荐, 可升级)
git clone git@github.com:duduanbin1982-max/MES.git /home/<user>/factory-mes
cd /home/<user>/factory-mes
npm ci        # 注意是 npm ci, 不是 npm install

# 方式 B: 上传 tarball
scp factory-mes-vX.Y.Z.tar.gz <server>:/home/<user>/
tar xzf factory-mes-vX.Y.Z.tar.gz -C /home/<user>/
```

### 4. 环境变量

```bash
cd /home/dubin/factory-mes
cp .env.example .env
# 编辑 .env, 至少改这两项:
#   JWT_SECRET: openssl rand -hex 64  (生产必须改)
#   FEISHU_WEBHOOK_TOKEN: 飞书机器人 URL 或 token (可选)

chmod 600 .env
```

### 5. 数据库初始化 (首次)

```bash
cd /home/dubin/factory-mes
node migrate.js                # 跑所有 migrations 001-017
node seed-demo.js              # 可选: 灌演示数据 (TBM-2026-001 实例)
```

### 6. systemd user 单元

```bash
# 复制单元文件到 user 目录
cp factory-mes.service /home/dubin/.config/systemd/user/

# 启用 + 启动
systemctl --user daemon-reload
systemctl --user enable --now factory-mes.service

# 验证
systemctl --user status factory-mes.service
curl http://127.0.0.1:3890/api/health
# 期望: {"status":"ok",...}
```

### 7. 启用夜间测试 timer (可选但推荐)

```bash
cp scripts/factory-mes-nightly-test.service /home/dubin/.config/systemd/user/
cp scripts/factory-mes-nightly-test.timer /home/dubin/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now factory-mes-nightly-test.timer
systemctl --user list-timers factory-mes-nightly-test.timer
# 期望: 每天 02:00 UTC 跑一次
```

### 8. nginx 反代 + TLS

```bash
# 生成 self-signed 证书 (生产换 Let's Encrypt)
sudo mkdir -p /home/dubin/factory-mes/ssl
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /home/dubin/factory-mes/ssl/key.pem \
  -out /home/dubin/factory-mes/ssl/cert.pem \
  -subj "/CN=192.168.1.73"
chmod 600 /home/dubin/factory-mes/ssl/key.pem

# 装 nginx 配置
sudo cp nginx/factory-mes.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/factory-mes.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 9. logrotate (防止 mes.log 撑爆盘)

```bash
# 见 INSTALL_LOGROTATE.txt
sudo cp scripts/factory-mes-logrotate.conf /etc/logrotate.d/factory-mes
sudo logrotate -d /etc/logrotate.d/factory-mes   # dry-run 验证
```

### 10. 烟测

```bash
# 1. 直连 (绕过 nginx, 验证 service)
curl http://127.0.0.1:3890/api/health

# 2. 走 nginx (验证反代 + TLS)
curl -k https://192.168.1.73/api/health

# 3. 拿 token + 登录
curl -k -X POST -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' \
  https://192.168.1.73/api/auth/login
```

## 升级流程

```bash
cd /home/dubin/factory-mes

# 1. 拉最新代码
git pull origin main
#   ↑ pre-push 钩子跑完整测试闸门 (需要本地测试通过, 但 pre-push 在 push 时跑,
#     pull 时不跑 -- 信任 GitHub Actions / 手动跑)

# 2. 装新依赖
npm ci

# 3. 跑测试 + 部署 (3 步一气呵成)
bash scripts/deploy.sh
# 内部: pre-deploy-test.sh (167 测试) -> systemctl restart -> curl /api/health
# 失败会自动阻断, 旧版本继续运行

# 4. 看日志
journalctl --user -u factory-mes.service -n 30 --no-pager
```

## 紧急逃生口

```bash
# 跳过测试 (生产紧急修复, 不推荐)
bash scripts/deploy.sh --no-test

# 跳过 git hooks
git commit --no-verify
git push --no-verify

# 手动重启
systemctl --user restart factory-mes.service
```

## 回滚

```bash
# 1. 看历史
git log --oneline -10

# 2. 软回滚 (生成 revert commit, 保留历史)
git revert HEAD
git push origin main
bash scripts/deploy.sh

# 3. 硬回滚 (重写历史, 强推, 仅在确认无其他人提交时用)
git reset --hard HEAD~1
git push --force-with-lease origin main
bash scripts/deploy.sh
```

## 备份与恢复

### 自动备份 (cron)

```bash
# scripts/backup-db.sh 已经按 db.js schema + 现有 cron 配好
# 手工跑:
bash scripts/backup-db.sh

# 看备份目录
ls -la /home/dubin/factory-mes/backups/
# 文件名格式: mes.db.YYYYMMDD_HHMMSS
```

### 手工备份

```bash
# WAL 模式下, 备份前先做 checkpoint
cd /home/dubin/factory-mes
sqlite3 data/mes.db "PRAGMA wal_checkpoint(TRUNCATE);"
cp data/mes.db backups/manual-$(date +%Y%m%d_%H%M%S).db
```

### 恢复

```bash
# 1. 停服
systemctl --user stop factory-mes.service

# 2. 备份当前 (以防)
mv data/mes.db data/mes.db.broken

# 3. 恢复
cp backups/mes.db.20260623_030001 data/mes.db
# 删 -wal / -shm (避免状态不一致)
rm -f data/mes.db-wal data/mes.db-shm

# 4. 启服
systemctl --user start factory-mes.service
curl http://127.0.0.1:3890/api/health
```

## 监控

### 健康端点

```bash
curl http://127.0.0.1:3890/api/health
# 返 { status: "ok", tables, instances, time }
# - 5xx 立即告警
# - tables 数量应 = 28 (新增 migration 后会变)
# - instances 应 >= 1 (seed 过的)
```

### 日志

```bash
# 实时 tail
journalctl --user -u factory-mes.service -f

# 最近 100 行
journalctl --user -u factory-mes.service -n 100 --no-pager

# 错误过滤
journalctl --user -u factory-mes.service -p err --since "1 hour ago"
```

### 数据库

```bash
# 磁盘占用
du -sh /home/dubin/factory-mes/data/mes.db*
ls -la /home/dubin/factory-mes/data/

# WAL 大小 (持续增长 = checkpoint 没跑)
ls -la /home/dubin/factory-mes/data/mes.db-wal

# 手动 checkpoint
sqlite3 /home/dubin/factory-mes/data/mes.db "PRAGMA wal_checkpoint(TRUNCATE);"
# scripts/wal-checkpoint.sh 已包好
```

### 测试闸门

```bash
# 手动跑 (不重启)
bash scripts/pre-deploy-test.sh
# 期望: pass=167 fail=0 skip=0

# 部署模式 (test -> restart -> health)
bash scripts/deploy.sh

# 夜间 timer 自动跑 (日志: data/nightly-test.log)
systemctl --user list-timers factory-mes-nightly-test.timer
```

## 常见故障

### service 起不来

```bash
# 看错误
journalctl --user -u factory-mes.service -n 50 --no-pager
# 常见原因:
# 1. JWT_SECRET 缺失或 < 32 字符 (auth.js 会主动 exit 1)
# 2. data/mes.db 损坏 (sqlite3 ... "PRAGMA integrity_check;")
# 3. 端口 3890 被占 (ss -ltnp | grep 3890)
# 4. 上一版本 ExecStartPre 失败 (测试闸门挂, 看 data/predeploy-*.log)
```

### 测试挂

```bash
# 看具体错
cat /home/dubin/factory-mes/data/predeploy-20260624_*.log | tail -30
# 常见:
# 1. mes.db schema 与测试期望不一致 (跑 node migrate.js)
# 2. fixtures 缺失 (node seed-demo.js)
# 3. python3 不可用 (集成测试需要)
```

### 推不到 GitHub

```bash
# 检查 SSH 认证
ssh -T git@github.com
# 期望: "Hi <user>! You've successfully authenticated..."
# 失败: 重新跑 docs/git-workflow.md 的 SSH 配置步骤
```

## 脚本索引

| 脚本 | 用途 | 调用方 |
|---|---|---|
| `scripts/deploy.sh` | 测试 + 重启 + 健康三步 | 手动 / 部署 |
| `scripts/pre-deploy-test.sh` | 测试闸门 (含语法体检) | deploy.sh / systemd ExecStartPre / 手动 |
| `scripts/run-all-tests.sh` | 跑 167 测试 | pre-deploy-test.sh / 夜间 timer |
| `scripts/backup-db.sh` | cron 备份 mes.db | cron |
| `scripts/wal-checkpoint.sh` | WAL truncate | cron |
| `scripts/cert-expiry-check.sh` | SSL 证书到期检查 | cron |
| `scripts/factory-mes-logrotate.conf` | logrotate 规则 | /etc/logrotate.d/ |
| `scripts/key_components_arrival_check.sh` | 关键件到货检查 | cron |

## 单元索引

| 单元 | 作用 |
|---|---|
| `factory-mes.service` | 主服务, 监听 3890, ExecStartPre 测试闸门 |
| `factory-mes-nightly-test.service` | 一次性, 跑 run-all-tests.sh |
| `factory-mes-nightly-test.timer` | 每天 02:00 UTC 触发 nightly service |

## 相关文档

- [Git 工作流](./git-workflow.md) — commit 规范 + 钩子
- [代码拆分指南](./splitting-guide.md) — 4 轮拆分套路
- `.env.example` — 环境变量模板
- `INSTALL_*.txt` — 历史安装备忘 (logrotate / nginx)