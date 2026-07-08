# IoT 数据生命周期策略

P0-2 引入 IoT 原始数据治理，避免 `iot_readings` 和 `iot_alarms` 无限增长撑满系统盘。

## 策略

- 原始读数 `iot_readings`：默认保留 7 天。
- 小时聚合 `iot_reading_hourly`：长期保留，用于趋势、OEE、设备监控报表。
- 已确认报警 `iot_alarms`：默认保留 30 天。
- 未确认报警：不自动删除，必须人工处理或系统归档。

## 定时任务

用户级 crontab 每天 `02:20` 执行：

```bash
/home/dubin/factory-mes/scripts/iot-lifecycle.sh
```

运行日志：

```bash
/home/dubin/factory-mes/logs/iot-lifecycle.log
```

## 可配置环境变量

```bash
IOT_RAW_READING_RETENTION_DAYS=7
IOT_ACKED_ALARM_RETENTION_DAYS=30
IOT_LIFECYCLE_BATCH_LIMIT=200000
```

## API

- `GET /api/iot/lifecycle/status`：查看当前原始数据、小时聚合、报警和最近一次治理结果。
- `POST /api/iot/lifecycle/run`：手动触发治理。
- `GET /api/iot/readings/hourly?hours=168`：读取小时聚合趋势。
