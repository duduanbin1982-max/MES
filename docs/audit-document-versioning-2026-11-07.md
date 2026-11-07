# 文档/图纸严格版本管理实施报告

> 日期：2026-11-07  
> 范围：文档/图纸版本管理（`/documents`）  
> 目标：把“有版本字段/版本历史”升级为**当前版、作废、版本号规则、锁定、回滚、历史下载控制**的严格版本管理。  
> 结果：核心闭环已落地；新增回归 **3/3**；全量部署闸门 **915/0**。

## 1. 交付摘要

| 能力 | 交付 |
|---|---|
| 当前版/作废 | `is_current`；新版本签发自动把同族旧版置 `obsolete`，记录 `obsolete_at/superseded_by` |
| 版本号规则 | 同族版本解析/递增（A0→A1…A9→B0）；签发必须大于当前版；上传新版本可自动取下一版号 |
| 版本锁定 | 签发自动锁定版本；支持手动锁定/解锁（解锁仅管理员） |
| 历史版本下载控制 | 非当前版默认只允许质量/审计/管理员下载/预览；普通用户只能看当前有效版 |
| 版本回滚 | 从历史版本生成新草稿版本（不修改历史），自动取下一版号并记录回滚来源 |
| 版本台账 | `version-ledger` 返回当前版、全部版本状态、锁定、审批、签收数、建议下一版号 |
| 前端 | 版本历史抽屉显示“当前有效/已作废/已锁定”，支持锁定/解锁/回滚；列表新增“新版本”入口 |

## 2. 数据模型

`documents` 新增：

- `is_current INTEGER DEFAULT 0`：当前有效版；
- `obsolete_at TEXT`：作废时间；
- `superseded_by INTEGER`：被哪个新版本替代；
- `version_locked INTEGER DEFAULT 0`、`locked_at`、`locked_by`：版本冻结；
- 文档状态新增 `obsolete`（已作废）。

保留原有：`version`、`document_family_id`、`parent_document_id`、`revision_note/reason`、`approval_status`。

## 3. 当前版与作废规则

- 签发 `PUT /documents/:id/issue`：
  1. 校验新版本号必须大于当前版本；
  2. 设置本文档 `issued`、`is_current=1`、`version_locked=1`；
  3. 同族其他 `issued/obsolete` 版本 → `obsolete`、`is_current=0`、`obsolete_at`、`superseded_by=新版本 id`；
  4. 同族所有版本先清 `is_current`，再置当前版；
  5. 记录 `supersede` 事件与审计。
- 收回：清 `is_current`；
- 归档：清 `is_current`；
- `currentVersionOf` 兼容历史数据：若无 `is_current`，回退取最新 `issued`。

## 4. 版本号规则

- 支持 `字母+数字` 格式：A0…A9、B0…；
- 递增：`A0→A1`、`A9→B0`、`Z9→AA0`；
- `GET /documents/:id/next-version` 返回建议下一版号；
- `GET /documents/:id/version-ledger` 返回当前版/全部版本/建议版号；
- 上传新版本（带 `parent_document_id`）：
  - 不传版本号 → 自动取下一版号；
  - 传版本号且 ≤ 父版本 → 拒绝；
  - 同族同版本号重复 → 409。
- 非标准版本号（如 V1.0）不参与严格递增，保留兼容。

## 5. 版本锁定

- 签发后自动 `version_locked=1`；
- `POST /documents/:id/lock` 手动锁定；
- `POST /documents/:id/unlock` 解锁（仅管理员/`*` 权限）；
- 锁定/解锁写 `document_events` + `audit_logs`；
- 版本抽屉显示“已锁定”，提供锁定/解锁按钮。

## 6. 历史版本下载/预览控制

新增 `canViewHistorical(req, db, row)`：

- 当前版：允许（仍需密级/下载策略校验）；
- 非当前版：
  - 质量、审计、文档管理员（角色含 quality/audit/document_controller、`*`、`document:history`、`document:secret`）允许；
  - 普通用户 → 403“历史版本仅质量/审计/管理员可下载，请使用当前有效版本”；
- 无当前版的存量文档保持兼容（不误伤历史数据）。

## 7. 版本回滚

`POST /documents/:id/rollback`：

- 默认取同族最近历史版本，也可指定 `source_document_id`；
- 校验源文件存在、同一文档族；
- 以源版本文件/元数据创建**新草稿版本**，自动取下一版号；
- `parent_document_id` 指向当前文档，`revision_note=回滚自 vX`，记录原因；
- 不修改历史版本，回滚后仍需审批→签发；
- 若新旧版本引用同一物理文件，清理时检测引用，避免误删。

前端版本抽屉对非当前 `obsolete/issued` 版本提供“回滚到此版本”。

## 8. 前端

- 状态增加“已作废”（obsolete）；
- 版本历史抽屉：
  - 显示“当前有效/已作废/已锁定”；
  - 当前版可锁定；已锁定可解锁；
  - 历史版可回滚；
- 文档列表每行新增“新版本”：
  - 自动获取建议版本号（next-version）；
  - 带入标题/编码/实例/BOM/父文档；
  - 上传时 `parent_document_id` 建立版本链。

## 9. 验证

| 项目 | 结果 |
|---|---|
| 新增 `tests/documentVersioning.test.js` | **3/3**：自动作废/current；历史下载限制/锁定/回滚；A9→B0 与版本递增校验 |
| 既有文档回归 | `documentChain` 6/6、`documentSecurity` 9/9、`documentService` 10/10、`documentControl` 2/2、`documentP1` 3/3、`documentEnterprise` 3/3 |
| 全量部署闸门 | **915/0** ✅ |
| 前端 eslint / vue-tsc / build:safe | 0 / 0 / 通过（已部署） |
| 生产 API | next-version/version-ledger/versions 均 200；示例文档建议下一版 A2 |
| Playwright | 版本历史抽屉正常显示版本/哈希/流水，无 pageerror |

## 10. 当前生产状态

- 5 条文档仍为草稿，同族已有 A0/A1；未签发，因此暂无 `current`；
- “新版本”会自动带出建议版本号（示例为 A2）；
- 签发后自动进入当前版/旧版作废逻辑；
- 存量数据未强制回填 `is_current`，首次签发时自动建立。

## 11. 已知边界

1. 版本号严格规则仅覆盖“字母+数字”，非标准版本号只做唯一性校验；
2. 自动作废只在新版本签发时触发，历史已存在的多份 issued 不会自动清理（生产当前均为 draft）；
3. 回滚复用源文件路径，不复制物理文件；清理有引用保护，但存储层未做内容寻址；
4. 回滚生成的是草稿，仍需审批/签发，不会直接成为当前版；
5. 没有独立“主版本/次版本”语义，只是字母/数字递增；
6. 版本级有效期使用每份文档自身字段，未做“同族版本生效区间”冲突校验；
7. Redline 仍是元数据/哈希级，不是图纸像素级差异；
8. 版本锁定目前阻止的是“再次锁定/解锁权限”，未新增编辑接口；后续如增加版本编辑需强制校验锁。

## 12. 复验方式

1. `https://192.168.1.73/documents` → Ctrl+Shift+R；
2. 任一文档 → “新版本”，确认版本号自动为下一版；
3. 上传后签发 → 查看旧版是否变“已作废”、新版“当前有效/已锁定”；
4. 打开“版本”抽屉 → 锁定/解锁、回滚；
5. 用普通账号下载旧版应 403，管理员可下载；
6. `node --test tests/documentVersioning.test.js`。
