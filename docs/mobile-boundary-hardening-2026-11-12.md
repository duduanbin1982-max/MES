# 移动端边界加固报告

> 日期：2026-11-12  
> 范围：离线范围、客户端时间可信度、幂等原子性  
> 结论：**三项边界均已加固；全量闸门 955/0。**

## 1. 加固一：离线范围扩展

原实现只覆盖扫码 start/pause/complete。本次扩展到：

| 动作 | 离线队列 | 同步接口 |
|---|---|---|
| 工单/工序开始、暂停、完成、卡住 | ✅ | `POST /api/scan/execute` |
| 异常上报 / 备注 | ✅ | `POST /api/scan/execute`，action=`note` |
| 报工提交 | ✅ | `POST /api/work-reports` |
| 报工审批通过 | ✅ | `PUT /api/work-reports/:id/approve` |
| 报工驳回 | ✅ | `PUT /api/work-reports/:id/reject` |

实现：

```text
frontend/src/mobile/scanQueue.ts
  kind: scan / work_report_create / work_report_approve / work_report_reject

frontend/src/mobile/useScanSync.ts
  按 kind 分派到对应接口
  网络/5xx 保持 pending；4xx 标记 failed
```

补充：

- 扫码异常/备注原来实际调用 `action=note`，但服务端动作白名单没有 `note`；本次已加入：
  - 工单/工序 `note` 动作；
  - 非终态均可备注；
  - 不改变工单/工序状态，不影响计时。
- 报工提交增加 `client_request_id`：
  - 离线队列的 item id 作为客户端请求 ID；
  - 服务端 `work_report_details.client_request_id` 唯一索引；
  - 重复补传返回已有报工，不重复插入。
- 报工审批/驳回按已有报工 ID 补传；审批接口本身已幂等（已审批返回 already）。

边界：

- 离线新建报工后不能立即离线审批（审批需要服务端分配报工 ID）；
- 撤销报工、月结锁定等管理动作未离线化；
- 当前离线队列仍是“单机、单用户”，不处理多设备并发编辑同一条报工。

## 2. 加固二：客户端时间校验与审计

新增迁移 `035_mobile_time_audit.sql`：

```text
mobile_time_audits
  device_id / operator_id / action / target_type / target_id
  client_time / client_now / server_time
  clock_skew_seconds / accepted / reason
```

校验规则：

```text
occurred_at 必须可解析
不能超过服务器时间 +5 分钟
不能早于服务器时间 -7 天
client_now 与服务器时间偏差不能超过 10 分钟
```

处理：

- 任一条件不满足：
  - 不使用客户端时间；
  - 使用服务器当前时间；
  - `accepted=0`；
  - 写审计记录；
  - 响应返回 `time_audit`；
- 正常：
  - `accepted=1`；
  - 按 occurred_at 写操作流水和 actual_start/end；
- 记录设备 ID、操作人、动作、目标、客户端时间、服务器时间、偏差秒数。

新增响应：

```json
{
  "time_audit": {
    "client_time": "...",
    "client_now": "...",
    "clock_skew_seconds": 0,
    "accepted": false,
    "reason": "CLIENT_TIME_TOO_OLD",
    "effective_time": "..."
  }
}
```

当前限制：

- 7 天是常量，后续可配置；
- 客户端仍可伪造 `client_now`，审计只能发现明显偏差，不能完全防作弊；
- 建议后续接设备指纹/服务端授时。

## 3. 加固三：幂等回执原子性

原实现：

```text
执行动作事务提交
→ 计算计时
→ 写幂等回执
```

如果进程在“动作提交后、回执写入前”崩溃，重试会重复执行。

改造后：

```text
外层事务：
  1. 执行业务动作（内层事务）
  2. 计算计时
  3. 生成响应
  4. 写幂等回执（无 OR IGNORE）
提交
```

异常处理：

- 回执唯一键冲突：
  - 外层事务回滚；
  - 读取已有回执；
  - 返回原响应，`idempotent_replay=true`。
- 回执写入失败：
  - 整个动作回滚；
  - 不会出现“动作成功但无回执”。

并发验证：

```text
同一 Idempotency-Key 并发 5 次 start
→ 5 个请求均 200
→ work_order_operations 只 1 条
→ scan_action_receipts 只 1 条
→ 工单只进入一次 in_progress
```

## 4. 验证

| 项目 | 结果 |
|---|---|
| 全量部署闸门 | **955/0** |
| 扫码 start/pause/complete | 通过 |
| 异常/备注 note 动作 | 已加入白名单 |
| 报工提交幂等 | 同 client_request_id 两次 → 同一条，第二次 already |
| 过期 occurred_at | 拒绝客户端时间，使用服务器时间，写审计 |
| 时间审计表 | accepted=0 / CLIENT_TIME_TOO_OLD 记录 |
| 并发幂等 | 5 请求 → 1 操作 / 1 回执 |
| 原有扫码/计时测试 | 9/9 通过 |

## 5. 仍未完成

1. **服务端 Web Push** 未接 VAPID/订阅；
2. **生物识别登录** 未启用 WebAuthn；
3. **iOS 摄像头** 无 html5-qrcode 回退；
4. **离线撤销报工/月结** 未覆盖；
5. **客户端时间防作弊** 仅审计明显偏差；
6. **多设备并发编辑** 同一条报工无锁。

## 6. 复验

1. 断网扫码开始/暂停/完成 → 队列；
2. 断网提交异常/备注 → 队列；
3. 断网提交报工 → 队列；
4. 联网后按顺序补传；
5. 重复补传同一动作 → 不重复；
6. 构造 30 天前的 occurred_at → 响应 `CLIENT_TIME_TOO_OLD`，工单使用服务器时间；
7. 同一 key 并发 start 5 次 → 只写 1 条操作。
