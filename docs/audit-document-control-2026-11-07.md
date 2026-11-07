# 文档/图纸 P0 受控文件闭环实施报告

> 日期：2026-11-07  
> 范围：文档/图纸（`/documents`）  
> 目标：落地 P0 四项：**文件审批与电子签署、版本与修订块、受控发放与签收、机号/日期有效性**。  
> 结果：核心能力已落地；新增回归 2/2；全量部署闸门 **906/0**。

## 1. 交付摘要

| P0 能力 | 交付 |
|---|---|
| 文件审批与电子签署 | 多级审批（校核/审核/批准）、提交审批、通过/驳回、电子签名哈希、审批中禁止签发、审批记录/意见/时间 |
| 版本与修订块 | 修订说明/修订原因、修订历史（同文档族版本+审批状态+上传/批准/签发时间） |
| 受控发放与签收 | 发放规则、按角色生成发放任务、签收任务、超期查询、新版本签发自动作废旧版待签任务、签收同步 |
| 有效性/机号 | 有效性类型（全部/指定机号/日期范围/序列号范围）、生效/失效日期、序列号起止、按日期查询生效文件 |

前端新增“受控”入口与“受控文件管理”抽屉（审批/修订块/发放签收/有效性 4 个页签）。

## 2. 审批与电子签署

### 2.1 数据结构

新增 `doc_approvals`：
- `doc_id / step_no / step_type(check/review/approve) / approver_role`；
- `status(pending/approved/rejected) / comment / signed_by / signed_at / signature`。

`documents` 增加：`approval_status(draft/in_review/approved/rejected)`、`submitted_at`、`approved_at`、`approved_by`。

### 2.2 流程与门禁

- `POST /documents/:id/submit`：
  - 仅 draft/rejected 可提交；
  - 按文档类型生成审批步骤：图纸默认 **校核(engineer) → 审核(quality_supervisor) → 批准(production_supervisor)**；其他类型默认 校核→批准；
  - 状态置 `in_review`。
- `POST /documents/:id/approve`：
  - 支持按 `step_id`/`step_no` 审批；
  - 角色必须匹配步骤审批角色，管理员放行；
  - 通过后记录意见、签署人、时间、签名哈希；驳回则整单 `rejected`；
  - 所有步骤通过后 `approval_status=approved`。
- 签发门禁：
  - `in_review` → 400“审批中的文档不能签发”；
  - `rejected` → 400“审批被驳回的文档不能签发”；
  - `approved` 可正常签发；
  - 未走审批的历史 draft 文档保持兼容（可直接签发），后续可收紧。

电子签名：`sha256(doc_id|version|step|user|comment|timestamp)` 存入 `doc_approvals.signature`，作为签署凭证（非 PKI 数字证书）。

## 3. 版本与修订块

- `documents` 增加 `revision_note`（修订说明）、`revision_reason`（修订原因/依据）；
- `PATCH /documents/:id/revision` 维护修订说明/原因；
- `GET /documents/:id/revisions` 返回同文档族所有版本：版本、状态、审批状态、修订说明、上传/批准/签发时间；
- 上传新版本时通过 `parent_document_id` 形成显式版本链（已有能力），修订块补充“为什么改、改了什么”。

## 4. 受控发放与签收

### 4.1 数据结构

- `document_distribution_rules`：`doc_type / role_code / department / mandatory / is_active`；
- `document_distribution_targets`：`doc_id / user_id / role_code / status(pending/acknowledged/superseded) / required_at / acked_at / superseded_at`。

### 4.2 行为

- 签发时按 `issued_to` 映射角色 + `distribution_rules` 自动生成发放任务；
- `GET /documents/:id/distribution` 查看应签收人员/状态/要求时间；
- `POST /documents/:id/distribution/regenerate` 手动重算；
- `POST /documents/distribution-targets/:id/ack` 签收自己的任务（管理员可代签），同步写 `doc_acknowledgements`；
- `GET /documents/distribution-overdue` 查询超期未签收（默认 3 天）；
- **新版本签发时，旧版本 pending 任务自动置 `superseded`**，避免旧版继续要求签收。

前端“发放与签收”页签展示人员、角色、状态、要求/实际签收时间。

## 5. 机号/日期有效性

`documents` 增加：
- `effectivity_type`：`all / instance / date_range / serial_range`；
- `effective_from / effective_to`；
- `serial_from / serial_to`。

接口：
- `PUT /documents/:id/effectivity`：设置类型/日期/序列号范围（日期格式、起止顺序校验）；
- `GET /documents/:id/effectivity`：查看当前有效性；
- `GET /documents/effective?instance_id=&as_of=&doc_type=`：按机号/日期查询当前生效的已签发/归档文件。

前端“机号/日期有效性”页签可维护。

## 6. 前端

- 文档列表每行新增“受控”按钮；
- 新增 `DocumentControlDrawer.vue`：
  - 审批与签署：状态、步骤、角色、意见、电子签名，提交/通过/驳回；
  - 修订块：编辑修订说明/原因，查看版本修订历史；
  - 发放与签收：应签收人员、状态、要求时间、重新生成；
  - 机号/日期有效性：类型、日期、序列号范围维护。

## 7. 验证

| 项目 | 结果 |
|---|---|
| 新增 `tests/documentControl.test.js` | **2/2**：审批/签署/签发动禁/发放签收；修订块/有效性/生效查询 |
| 既有文档回归 | `documentSecurity` 9/9、`documentChain` 6/6、`documentService` 10/10 |
| 全量部署闸门 | **906/0** ✅ |
| 前端 eslint / vue-tsc / build:safe | 0 / 0 / 通过（已部署） |
| 生产 API | approvals/revisions/effectivity/effective/overdue 200；distribution 200（修复了 `users.role_code` 兼容） |
| Playwright | `/documents` 5 条文档均显示“受控”；打开抽屉四个页签正常，无 pageerror |

## 8. 当前生产状态

- 现有 5 条文档仍为草稿（approval_status=draft），尚未走审批；
- 受控抽屉可查看/提交审批；签发时发放任务按角色生成；
- 无自动化强制历史文档补审批，保留兼容。

## 9. 已知边界

1. 审批角色配置目前写死在代码（图纸 3 级、其他 2 级），后续可做成可配置审批模板；
2. 电子签名为 SHA-256 签署哈希，不是 CA/PKI 数字证书；如需法律级签名需接 CA；
3. 历史 draft 文档仍可直接签发（兼容），建议后续切换为“必须审批后才能签发”；
4. 发放规则有 API 但前端规则管理入口未做（目前按 `issued_to` 角色映射为主）；
5. `serial_range` 已存储，但 `GET /documents/effective` 暂只按机号/日期过滤，序列号范围匹配待接入机号序列；
6. 审批驳回后未自动生成修订任务/ECO，需人工重新提交；
7. 签收超期提醒目前只提供查询接口，未接消息/邮件/企微通知。

## 10. 复验方式

1. `https://192.168.1.73/documents` → Ctrl+Shift+R；
2. 任一文档点“受控” → 提交审批 → 逐级通过（管理员可代审）；
3. 审批中尝试签发 → 应被拒绝；全部通过后签发成功；
4. 签发后查看“发放与签收”是否生成应签收人员；
5. “修订块”填写修订说明；“有效性”设置日期范围；
6. `GET /documents/effective?instance_id=1&as_of=2026-11-07` 查看生效文件；
7. `node --test tests/documentControl.test.js`。
