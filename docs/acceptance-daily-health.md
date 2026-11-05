# 每日端到端健康检查（systemd timer）

> 2026-11-05 上线。每天 **06:00（Asia/Shanghai）** 自动跑一遍 TBM-DEMO-001 端到端验收，结果落到 `logs/acceptance/`，失败时退出码非 0、`latest.status` 变 `fail`。

## 1. 它每天做什么

执行 `node scripts/acceptance-e2e.js --health`：

| 环节 | 说明 |
|---|---|
| 项目/里程碑 | 项目可读；里程碑计划日期完整、按阶段递增（**健康检查不改里程碑状态**，避免连跑几天把里程碑全推成已完成） |
| 工序计划 | 建 4 道工序 + 3 条 FS 依赖 |
| 排程 | dryRun 预演不写库 → 应用 → SC 批次 → FS 顺序满足 → 拖拽返回 DT 批次 |
| 工单 | 创建并关联工序 → 派工 → 开工 → 报工 → 自动完工 |
| 质检 | 检验记录创建 / 按工单查回 / 统计递增 |
| OEE | 补录 2 个班次 → ISA-95 可用率与 OEE 合理；主视图口径 `shift_workers` |
| 资源平衡 | 演练任务出现在 `/resources/gantt` 窗口内 |
| 清理 | 跑完自动清掉本次创建的工序/依赖/工单/质检/班次（**只动 TBM-DEMO-001**） |

固定输出：

```
logs/acceptance/latest.status   # 一行：ok|fail <时间> steps=x/y checks=a/b
logs/acceptance/latest.md       # 最近一次人可读报告
logs/acceptance/latest.json     # 最近一次机器可读报告
logs/acceptance/e2e-<ts>.{json,md}  # 历史报告（保留最近 30 份，自动裁剪）
logs/acceptance/health.log      # systemd 每次执行的 stdout/stderr
```

## 2. 安装 / 卸载

```bash
# 安装并启用（幂等，可重复执行）
bash scripts/install-acceptance-timer.sh

# 安装后立刻跑一次
bash scripts/install-acceptance-timer.sh --run-now

# 查看下一次触发
systemctl --user list-timers factory-mes-acceptance.timer

# 临时停用 / 恢复
systemctl --user disable --now factory-mes-acceptance.timer
systemctl --user enable --now factory-mes-acceptance.timer
```

单元文件在仓库 `deploy/systemd/`，安装脚本会拷到 `~/.config/systemd/user/` 并 `daemon-reload`。
本机已开启用户 linger（`Linger=yes`），未登录也会按时跑。

## 3. 看结果

```bash
cat logs/acceptance/latest.status          # 一行结论
cat logs/acceptance/latest.md              # 每项检查明细
tail -50 logs/acceptance/health.log        # 最近几次 systemd 执行输出
systemctl --user status factory-mes-acceptance.service --no-pager
```

`latest.status` 示例：

```
ok 2026-11-05T13:59:58.157Z steps=8/8 checks=38/38
fail 2026-11-06T06:00:12.001Z steps=7/8 checks=35/38
```

## 4. 失败怎么处理

1. `cat logs/acceptance/latest.md` 找 ❌ 行（例如"排程应用失败"），里面带 API 返回信息；
2. 手动重跑复现：`npm run acceptance:health`；
3. 修复后用 `bash scripts/install-acceptance-timer.sh --run-now` 再验证一次。

常见原因：服务未启动（`systemctl --user status factory-mes`）、数据库/迁移未就绪、`.env` 里 `JWT_SECRET` 失效。

## 5. 告警接入（可选）

最简单：外部监控读 `logs/acceptance/latest.status`，首词不是 `ok` 就告警。示例（cron）：

```bash
*/30 * * * * grep -q '^ok ' /home/dubin/factory-mes/logs/acceptance/latest.status || echo "MES 日检失败: $(cat /home/dubin/factory-mes/logs/acceptance/latest.status)"
```

也可以在 `factory-mes-acceptance.service` 加 `ExecStartPost` 调 webhook/邮件脚本。

## 6. 注意

1. **健康检查独占 TBM-DEMO-001 的业务数据**：每次都会先清空该演练项目的工序/依赖/工单/质检/班次再重建（里程碑保留）。不要把真实项目改成 `TBM-DEMO-001` 的编码；
2. `health.log` 是 append 增长，建议加 logrotate 或定期截断（例如 `truncate -s 5M`）；
3. 历史验收报告默认只保留最近 30 份（`pruneReports`），`latest.*` 永远覆盖最新；
4. 健康检查**不进部署闸门**（会动演练数据），只由 timer 或手动触发。
