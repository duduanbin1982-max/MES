# 参数配置模块审计报告

> 日期：2026-11-09  
> 模块：`/settings`「系统设置 / 参数配置」  
> 代码：`services/systemSettings.js`、`routes/settings.js`、`frontend/src/views/Settings.vue`  
> 结论：**发现 2 个 P0（6/10 参数实际不生效且页面宣称即时生效、敏感参数编辑可能被清空）、7 个 P1；本轮修复 11 项，新增回归 4 条，全量闸门 943/0。**

## 1. 审计范围

- 参数读取/写入、类型转换、敏感值脱敏；
- 参数消费方与“修改后是否真正生效”；
- 飞书通知配置与测试；
- API 权限、审计日志、错误处理；
- 前端参数编辑交互（字符串/数值/布尔/JSON/敏感值）；
- 自动化测试。

## 2. 生产现状

`system_settings` 共 **10 项**：

| Key | 当前值 | 类型 | 是否真正生效 |
|---|---|---|---|
| `default_lead_time_buffer_days` | 7 | number | ✅ 物料计划 MRP |
| `feishu_enabled` | 0 | boolean | ✅ 飞书通知 |
| `feishu_webhook_token` | 测试 URL（敏感） | string | ✅ 飞书通知 |
| `feishu_webhook_timeout_ms` | 3000 | number | ✅ 飞书通知 |
| `cert_expiry_alert_days` | 30 | number | ❌ 未接入（描述为 TLS 证书） |
| `shop_timezone` | Asia/Shanghai | string | ❌ 未接入 |
| `wal_alert_threshold_mb` | 100 | number | ❌ 未接入 |
| `workday_start_time` | 08:00 | string | ❌ 未接入 |
| `workday_end_time` | 18:00 | string | ❌ 未接入 |
| `feishu_receiver_open_id` | 空 | string | ❌ 仅记录，webhook 群发未定向 |

> 飞书 token 当前为 `.../test-token-12345` 测试地址，且 `feishu_enabled=0`，实际通知链路未启用。

## 3. 问题清单

| 编号 | 级别 | 问题 | 影响 | 处理 |
|---|---|---|---|---|
| S-01 | **P0** | 10 项参数中 6 项没有任何业务读取；页面却统一显示“修改后即时生效（5s 缓存）” | 管理员改参数无效果，误以为已生效 | **已修复**：新增消费方/`implemented` 元数据；未接入项在列表与编辑框明确告警；仅“已接入”参数宣称生效 |
| S-02 | **P0** | 编辑敏感参数时值为空；用户直接保存会用空字符串覆盖真实 token | 飞书通知被静默破坏 | **已修复**：敏感值留空=保持不变；需显式勾选“清空敏感值”才清除；接口支持 `clear_secret` |
| S-03 | P1 | `setOne` 不校验类型：number 可写 `abc`，boolean 可写任意文本，JSON 可写非法串 | 消费方得到 NaN/错误逻辑 | **已修复**：number/boolean/JSON 校验 + 数值上下限；非法返回 400 |
| S-04 | P1 | 参数修改无审计日志，仅 `updated_by/updated_at` | 无法追溯谁改了关键配置 | **已修复**：`settings.update` 写 `audit_logs`，敏感值打码 |
| S-05 | P1 | 布尔/JSON 在 UI 中都是文本框，JSON 对象显示为 `[object Object]` | 易误操作 | **已修复**：布尔开关、数值输入、JSON 文本域、敏感密码框 |
| S-06 | P1 | “测试飞书”按钮对仅 `settings:read` 用户可见，点击必 403 | 无意义报错 | **已修复**：按 `feishu:notify` 隐藏 |
| S-07 | P1 | load/save/测试飞书均无 catch，接口失败无提示 | 白屏式无反馈 | **已修复**：统一错误提示 |
| S-08 | P1 | 无消费方/生效状态元数据 | 无法判断哪些参数是“预留” | **已修复**：API 返回 `consumer/implemented/note`，UI 展示“生效范围” |
| S-09 | P1 | `cert_expiry_alert_days` 描述是 TLS 证书，但曾被误认为人员资质证书；人员资质实际固定 30 天 | 口径混淆 | **已修复**：恢复为“TLS 预留”，人员资质保持固定 30 天并记录 |
| S-10 | P1 | 原有测试仅覆盖 env fallback，不覆盖参数读写 | 回归无保护 | **已修复**：新增 4 条 systemSettings 测试 |
| S-11 | P2 | 敏感参数明文存 SQLite | 数据库泄露即 token 泄露 | 未处理，记录建议 |
| S-12 | P2 | `/api/settings` 与 `/api/settings-all` 重复 | 维护冗余 | 保留兼容，未删 |

## 4. 本轮修复

### 4.1 生效状态元数据

`SETTING_META` 为每个 key 登记：

- `consumer`：真正读取它的模块；
- `implemented`：是否已接入；
- `note`：预留/未接入原因；
- 数值参数的 `min/max`。

API `GET /api/settings` 返回上述字段。前端新增“生效范围”列：

- 绿色：已接入（如 物料计划 MRP、飞书通知）；
- 黄色“未接入”：仅存储，不改变业务。

页面顶部文案改为：

> 已接入参数 5s 内生效；标记“未接入”的参数仅存储，不改变业务。

### 4.2 真正接入的参数

- `default_lead_time_buffer_days` 已接入 `materialPlanner.mrp`：
  - 物料交期 = `key_components.lead_time_weeks × 7 + bufferDays`；
  - 返回值新增 `lead_time_buffer_days`；
  - 当前生产值 7 天，会使 MRP 建议下单日提前 7 天。
- `feishu_enabled / feishu_webhook_token / feishu_webhook_timeout_ms` 原本已接入 `feishuNotify`。

### 4.3 读写校验与敏感值

- number：有限数值 + 上下限；
- boolean：只接受 true/false、1/0；
- JSON：必须可解析；
- string：长度 ≤10000；
- 敏感值：
  - 留空 → 保持原值；
  - 显式 `clear_secret=true` → 清空；
  - API 永不回显明文。

### 4.4 审计与权限

- `PUT /api/settings/:key` 写 `audit_logs`：`settings.update`；
- 测试飞书写 `settings.feishu.test`（成功/失败）；
- 敏感值审计统一打码 `***`；
- 测试飞书按钮按 `feishu:notify` 显示。

### 4.5 前端交互

- 数值：`el-input-number`；
- 布尔：`el-switch`；
- JSON：多行文本域；
- 敏感：密码框 + “留空保持不变”；
- 未接入参数：编辑框顶部黄色告警 + “仅存储”标签；
- 保存/加载/发送失败均有中文提示。

## 5. 验证

| 项目 | 结果 |
|---|---|
| `tests/systemSettings.test.js` | **4/4** |
| 全量部署闸门 | **943/0** ✅ |
| 前端 eslint / vue-tsc / build | 0 / 0 / 通过（已部署） |
| 生产 `GET /api/settings` | 10 项，4 项 `implemented=true`，6 项未接入并带说明 |
| 非法数值 PUT | 400，`数值格式不正确` |
| 非法布尔 PUT | 400，`布尔值只能是 true/false 或 1/0` |
| 敏感值空值 PUT | 200，`changed=0, kept=true`，原 token 不变 |
| 生产 MRP | 200；示例物料 `lead_time_days=35`、`lead_time_buffer_days=7`，证明缓冲已生效 |
| 审计日志 | 已产生 `settings.update`，敏感值显示 `(unchanged)` |
| Playwright `/settings` | 10 行、6 个“未接入”标签、数值/密码/告警弹窗正常，无 pageerror |

## 6. 仍需业务/研发处理

1. **TLS 证书告警未接入**：`cert_expiry_alert_days` 当前不影响任何业务；人员资质临期固定 30 天。
2. **WAL 告警未接入**：`wal_alert_threshold_mb` 只是存储。
3. **车间时区未接入**：`shop_timezone` 未被调度/显示使用。
4. **工作日历未接入**：`workday_start_time/end_time` 未被排产/工时使用。
5. **飞书定向接收人未应用**：`feishu_receiver_open_id` 仅记录，webhook 仍群发。
6. **飞书生产配置**：当前 token 为测试地址且未启用，需换成真实机器人 webhook 并打开 `feishu_enabled`。
7. **敏感参数加密**：目前明文存 SQLite，建议后续使用 KMS/密钥加密。
8. **交期缓冲生效影响**：`default_lead_time_buffer_days=7` 已让 MRP 下单日提前 7 天，需计划部门确认。
9. 未接入参数目前仍允许编辑（仅存储）；是否直接禁用编辑需产品确认。
10. 非法写入未记失败审计（仅成功/测试调用记录）。

## 7. 复验

1. `https://192.168.1.73/settings` → Ctrl+Shift+R；
2. 确认 10 项参数，6 项显示黄色“未接入”；
3. 编辑 `default_lead_time_buffer_days`，应出现数值输入框；
4. 编辑 `feishu_webhook_token`，应为密码框，留空保存提示“未修改敏感值”；
5. 编辑 `shop_timezone`，应出现“未接入”黄色告警；
6. 非法数值保存应提示格式错误；
7. `node --test tests/systemSettings.test.js`。
