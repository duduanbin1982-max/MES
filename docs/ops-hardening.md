# 运维硬化记录（P0-A，2026-10-18）

上线前把四件"出事才会痛"的事做完：**TLS 信任、备份可恢复、巡检告警、依赖与 CI**。

## 一、TLS：换成内网 CA 签发

### 现状

| 项 | 值 |
|---|---|
| 根 CA | `CN=TBM Internal CA, O=TBM Factory, C=CN`，有效期 **10 年**（到 2036-10） |
| 服务端证书 | `CN=tbm.lan`，由内网 CA 签发，**397 天**（到 2027-11-19） |
| SAN | `tbm.lan` / `mes.tbm.lan` / `erp.tbm.lan` / `localhost` / `192.168.1.73` / `127.0.0.1` |
| 私钥位置 | `/home/dubin/pki/ca/ca.key`、`/home/dubin/pki/server/server.key`（600，**不入库**） |
| nginx 使用 | `/home/dubin/factory-mes/ssl/cert.pem`（证书链）、`ssl/key.pem` |
| 根 CA 分发 | 仓库内 `ssl/tbm-root-ca.crt` / `.cer`；网页下载 `http://192.168.1.73/tbm-root-ca.crt` |

签发/续期脚本：`scripts/pki-issue.sh`（幂等；CA 已存在则复用，避免客户端已信任的根失效）

```bash
sudo bash scripts/pki-issue.sh        # 首次签发或续期（覆盖 cert.pem/key.pem）
sudo nginx -t && sudo systemctl reload nginx
```

### 客户端安装根 CA（每台电脑一次）

**Windows（Chrome / Edge 用系统证书存储）**

1. 浏览器打开 `http://192.168.1.73/tbm-root-ca.crt` 下载（或 `\192.168.1.73` 共享拷贝）
2. 双击 → **安装证书** → 存储位置选 **本地计算机** → **受信任的根证书颁发机构** → 完成
3. 关闭并重开浏览器；访问 `https://192.168.1.73` 应显示锁标志、无警告

命令行（管理员 PowerShell）：
```powershell
certutil -addstore -f Root tbm-root-ca.crt
```

**Linux / 服务器**
```bash
sudo cp tbm-root-ca.crt /usr/local/share/ca-certificates/tbm-mes-ca.crt
sudo update-ca-certificates
```

**Firefox**（用自己的证书库，需单独导入）：设置 → 隐私与安全 → 证书 → 查看证书 → 证书颁发机构 → 导入 → 勾选"信任由此 CA 标识的网站"

### 验证

```bash
# 服务端视角：链校验必须 ok
echo | openssl s_client -connect 127.0.0.1:443 -servername 192.168.1.73 \
  -CAfile /home/dubin/factory-mes/ssl/tbm-root-ca.crt 2>/dev/null | grep "Verify return code"

# 客户端视角
curl --cacert tbm-root-ca.crt https://192.168.1.73/api/health
```

> ⚠️ **根 CA 私钥务必备份**（`/home/dubin/pki/ca/ca.key`，离线保存）。丢失后所有客户端都要重装新 CA。

### 回滚

脚本会自动把旧证书备份为 `ssl/cert.pem.selfsigned.<时间戳>`；回滚：
```bash
sudo cp ssl/cert.pem.selfsigned.<时间戳> ssl/cert.pem
sudo cp ssl/key.pem.selfsigned.<时间戳> ssl/key.pem
sudo systemctl reload nginx
```

## 二、备份与恢复演练（已存在，2026-10-18 复核通过）

| 项 | 现状 |
|---|---|
| 数据库备份 | cron `15 */4 * * *`，`VACUUM INTO` 快照 + 内容新鲜度校验（audit_logs.max） |
| 每周快照 | 保留 8 周；每日保留 3 天 |
| 异地备份 | 每日 03:30 rsync 到 NAS `192.168.1.10:/volume2/mes-backup/192.168.1.73` |
| 本地恢复演练 | 每周日 04:30（`restore-drill-local.sh`） |
| 异地恢复演练 | 每周日 04:50（`restore-drill-offsite.sh`，含 NAS 端完整性 + 传输保真双校验） |

**2026-10-18 实际执行结果**（日志 `logs/restore-drill-*.log`）：

```
[drill-local]  04:30:01 success  db=mes.db.20261018_041501  sha256=368756da…  tables=137 integrity=ok
                counts: equipment_instances 4 / work_orders 4 / materials 36 / instance_bom 79 / process_nodes 170 / users 7
                （关键表行数与生产一致，且不"新于生产"）
[drill-offsite] 04:50:02 success origin=mes.db.20261018_001501  ①NAS 端完整性 ok  ②传输保真 ok
```

结论：**RPO ≈ 4 小时**（备份间隔）；本地/异地恢复均可用。恢复耗时取决于库大小（当前 2MB 级，秒级完成）。

## 三、巡检与告警

`scripts/ops-daily-check.sh` 每日 08:30 输出一行 `ROSTER` + 明细，覆盖：
服务健康、备份新鲜度/完整性、异地备份、本地/异地演练新鲜度、日志轮转与体积、WAL 体积、predeploy 日志规模、
**TLS 证书剩余天数（P0-A 新增 `tls:` 行）**。

**2026-10-18 22:05 实际输出**

```
[ops-check] predeploy logs: files=505 zero_byte=0
[ops-check] tls: cert.pem=396d tbm-root-ca.crt=3649d
[ops-check] ROSTER: OK
```

> 飞书 webhook 已按决策停用，告警只会写入审计日志 + `logs/ops-daily-check.log`。
> 建议：恢复一个轻量告警渠道（企业微信/邮件/飞书任一），或把"每日看一眼 ROSTER"写进值班表。

## 四、依赖与 CI

| 项 | 现状 |
|---|---|
| 生产依赖漏洞 | `npm run audit` → **0 vulnerabilities** |
| CI 审计 | `.github/workflows/test.yml` 已加"依赖安全审计（high 级阻断）"步骤 |
| Node 版本 | `.nvmrc` = `22.22.3`；`package.json` `engines.node` = `>=22 <23` |
| 本地等价闸门 | `npm run predeploy`（lint + 全量测试 + 前端模板编译 + domain 单测） |

CI 运行状态需在 GitHub 仓库 Actions 页确认（服务器侧无法查询，需仓库权限）。

## 五、遗留与建议

1. **客户端还没装根 CA** —— 装完之前浏览器仍会警告；这是需要在每台电脑做一次的动作（步骤见第一节）。
2. **服务端证书 397 天** —— `cert-expiry-check.sh` 每日 05:00 检查，<30 天写告警；到期前跑一次 `scripts/pki-issue.sh` 即可续期（无需客户端重装 CA）。
3. **告警渠道** —— 当前静默；建议恢复一个。
4. **备份文件权限** —— `ssl/` 下 CA 分发文件 root 所有（只读），备份脚本已覆盖 `data/`，`ssl/` 的 CA 建议一并纳入离线备份清单。
