# 文档/图纸模块审计报告

> 审计对象：`/documents`（文档/图纸：上传 → 签发 → 签收 → 版本 → 收回 → 归档；下载；BOM/ECO 关联）  
> 审计日期：2026-11-07  
> 审计方式：代码走读（`services/documentService/**` + `queryRoutes/mutationRoutes/storage/history`）+ 生产接口实测  
> 生产数据：documents 5 行（均 draft/drawing）、签收 0 行、上传目录 `data/uploads`

## 0. 结论摘要

**整改前评级：C+** —— 上传→签发→签收→版本→收回链路完整（上一轮已修过签收/版本/上传字段等），但**文件安全与数据范围**存在 2 个 P1：

- 上传**不校验类型/大小/归属**：任意扩展名（exe/脚本/HTML）、任意实例 ID、跨实例 BOM 关联都能入库；
- 文档**没有数据范围过滤、下载不审计**：有 `document:read` 即可下载任意项目图纸/合同，且下载行为无任何留痕。

**整改后：A（2 个 P1 + 3 个 P2 + 4 项 P3 全部修复）**

| 编号 | 级别 | 问题（实测） | 状态 |
|---|---|---|---|
| D-1 | **P1** | 上传无文件类型/大小/归属校验：`evil.exe` 可入库；`equipment_instance_id=999`、跨实例 `bom_node_id` 均可；文件名可含路径/控制字符 | 已修 |
| D-2 | **P1** | 列表/详情/下载无数据范围过滤；下载不写 document_events（图纸外流无痕） | 已修 |
| D-3 | P2 | 上传/签发/收回/归档只写 `document_events`，不写 `audit_logs` | 已修 |
| D-4 | P2 | 列表 `LIMIT 500` 无分页、无总数 | 已修（page/page_size/total） |
| D-5 | P2 | 同 `doc_code + version` 可重复上传；文件名原样存库/响应头 | 已修 |
| D-6 | P3 | 签收未校验 issued_to；无保留期/物理清理；版本链依赖 doc_code 后缀；无在线预览/水印 | **已全部修复**（角色校验/保留期清理/显式版本链/预览水印） |

## 1. 发现与整改明细

### D-1（P1）上传安全

整改：
- 扩展名白名单（pdf/dwg/dxf/step/office/图片/压缩包等），显式拒绝 exe/js/html/svg/sh/bat/ps1 等；
- 50MB 大小上限（`DOCUMENT_MAX_BYTES` 可配）+ MIME 前缀校验；
- 文件名 `sanitizeFileName`：去路径、去控制字符、去 `<>:"|?*`、限 200 字符；
- `equipment_instance_id` 必须存在；
- `bom_node_id` 必须存在且**属于该装备实例**；
- `eco_id` 关联表缺失时返回 400 而非 500；
- 同 `doc_code + version` 重复 → 409。

实测：exe → 400「不允许上传该类型文件」；跨实例 BOM → 400；路径穿越文件名 `../../evil.pdf` 落库为 `evil.pdf`，存储路径在 `uploads/YYYY/MM/` 下；重复编号版本 → 409。

### D-2（P1）数据范围与下载审计

整改：
- 新增 `documentService/access.js`：按用户生效数据范围（`req.scope()`）过滤文档；
  - `all` 全量；
  - `instance` → `equipment_instance_id IN (project_ids/instance_ids)`；
  - `self` → `uploaded_by/issued_by = 当前用户`；
  - `workshop` → 关联 `equipment_instances.subsystem_id`；
  - 其他范围安全拒绝；
- 列表/详情/下载/版本/历史统一走 `scopeWhere / canAccessDocument`；
- 下载写 `document_events(action='download', operator_id)`，并补 `X-Content-Type-Options: nosniff`、`filename*` 规范响应头。

实测：下载成功且 `document_events` 出现 download 记录；跨项目文档详情/下载返回 404。

### D-3（P2）生命周期审计

新增 `audit_logs`：`document.upload / document.issue / document.revoke / document.archive`（含操作人、资源 ID、diff_summary）。实测签发后 `document.issue` 审计存在。

### D-4（P2）列表分页

`GET /api/documents?page=&page_size=`（默认 1/50，最大 200），返回 `items/total/page/page_size`；总数按过滤条件统计。

### D-5（P2）重复与文件名

- 同 `equipment_instance_id + doc_code + version` 重复 → 409；
- 保存/响应头使用清理后的文件名（下载头同时给 ASCII fallback 与 `filename*=UTF-8''`）。

### D-6（P3，记录）

1. 签收只要求"已签发 + 登录"，未校验用户部门/角色与 issued_to 的匹配（如 `assembly` 文档任何有 document:read 的人可签）；
2. 无文档保留期/物理清理策略（归档只改状态，文件永久保留）；
3. 版本链按 `doc_code` 去版本后缀聚合，依赖编码规范；
4. 无在线预览/水印/防截屏。

## 1.7 D-6 P3 全修（2026-11-07）

### 1.7.1 签收角色校验

- 新增 `ISSUE_TARGET_ROLES`：签发对象 → 允许签收角色（assembly: worker/welder/foreman；qc: qc/inspector；warehouse: warehouse 等），admin 始终放行；
- 签收时校验角色，不匹配 → 403；待签收列表同样只显示当前角色可签的文档；
- 实测：qc 签收 assembly 文档 → 403；worker 签收 → 200。

### 1.7.2 保留期与物理清理

- `documents` 增加 `retention_until`、`purged_at`；
- 归档时按类型写入保留期（图纸/工艺/SOP 10 年、合同 7 年、报表 5 年，可用 `DOC_RETENTION_YEARS_*` 覆盖）；
- `POST /api/documents/:id/purge`：仅已归档且到期（或 admin force）才物理删除文件并置 `status=purged`，写 `document.purge` 审计与 purge 事件；
- `POST /api/documents/purge-expired`：批量清理到期文档；
- 实测：归档 retention=2036；未到期清理 400；到期清理 200 且物理文件删除。

### 1.7.3 显式版本链

- `documents` 增加 `document_family_id`、`parent_document_id`；上传支持 `parent_document_id`（必须同实例），自动继承 family；
- 版本列表/历史优先按 `document_family_id` 聚合，不再依赖 `doc_code` 后缀正则；
- 同 family + version 重复上传 409；
- 迁移脚本 `scripts/migrate-document-family.js --apply` 已回填 5 条历史文档；
- 实测：A0→A1 显式版本链 versions 返回 2 条。

### 1.7.4 在线预览与水印

- 新增 `GET /api/documents/:id/preview`：pdf/图片/文本内联预览，带 `X-Document-Watermark`（用户@时间）、`Cache-Control: no-store`、`Content-Security-Policy: sandbox`、`X-Content-Type-Options: nosniff`；写 preview 事件；
- 非预览类型（xlsx 等）返回 400 引导下载；
- 前端文档列表新增「预览」按钮；预览弹窗叠加"用户+时间"水印、禁用右键、底部提示请勿截屏外传；
- 实测：pdf 预览 200 + preview 事件；xlsx 预览 400。

## 2. 验证

| 项目 | 结果 |
|---|---|
| `tests/documentSecurity.test.js`（新） | **5/5**（上传安全/文件名/重复/审计+下载事件/分页+范围） |
| 全量部署闸门 | **841/0** ✅ |
| 生产演练 | exe 400、pdf 200 + 路径清理、重复 409、签发审计、下载事件、分页；**演练数据已清理** |

## 3. 改动文件

| 文件 | 说明 |
|---|---|
| `services/documentService/meta.js` | 类型/大小/文件名校验 |
| `services/documentService/access.js` | 数据范围过滤（新） |
| `services/documentService/mutationRoutes.js` | 上传校验/归属/重复、生命周期 audit_logs |
| `services/documentService/queryRoutes.js` | 分页、范围过滤、下载审计与安全头 |
| `tests/documentSecurity.test.js` | 5 个回归用例 |
| `scripts/migrate-document-family.js` | 历史文档显式版本链回填（幂等） |
| `frontend/src/views/documents/DocumentListCard.vue`、`DocumentManagement.vue`、`api/documents.ts` | 预览入口/水印弹窗 |
| `docs/audit-documents-2026-11-07.md` | 本报告 |

## 4. 复验方式

```bash
node --test tests/documentSecurity.test.js
```

前端：`/documents` → 上传 exe/脚本应被拒；不同数据范围账号（如 instance 范围）只能看到本项目文档；下载后可在文档历史里看到 download 记录。
