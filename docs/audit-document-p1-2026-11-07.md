# 文档/图纸 P1 图纸特有能力的实施报告

> 日期：2026-11-07  
> 范围：文档/图纸（`/documents`）  
> 目标：落地 P1 四项：**图纸对比/批注、CAD/PDF 预览与转换、分类分级与下载策略、与 BOM/ECO/工艺/工单联动**。  
> 结果：核心能力已落地；新增回归 3/3；全量部署闸门 **909/0**。

## 1. 交付摘要

| P1 能力 | 交付 |
|---|---|
| 图纸对比/Redline/批注 | 文档批注表与 CRUD；两版元数据差异对比（版本/文件哈希/密级/策略/BOM/ECO/工单等）；同族版本选择；批注状态 open/resolved |
| CAD/PDF 预览与转换 | PDF/图片/文本原生预览；转换能力探测接口；配置外部转换器后可扩展 CAD/Office→PDF（当前服务器未安装，返回明确提示） |
| 分类分级与下载策略 | 密级 public/internal/confidential/secret；下载策略 allow/preview_only/watermark_only/no_print；secret 仅管理员/授权可见；preview_only 禁止下载；no_print 下发响应头 |
| 与 BOM/ECO/工艺/工单联动 | `links` 接口返回 BOM 节点/ECO/工单/关联工艺节点/同族版本/批注数；支持按 BOM、ECO、工单反查文档 |

前端“受控文件管理”抽屉由 4 个页签扩展为 7 个：审批与签署、修订块、发放与签收、机号/日期有效性、**批注/对比、密级/下载、关联影响**。

## 2. 批注与版本对比

### 2.1 批注

新增 `document_annotations`：
- `doc_id / version / page_no / x_pct / y_pct / annotation_type(note/issue/change) / content / status(open/resolved) / parent_id / created_by / resolved_by / resolved_at`。

API：
- `GET /documents/:id/annotations`（可按 status 过滤）
- `POST /documents/:id/annotations`（内容/页码/坐标百分比校验）
- `PATCH /document-annotations/:id`（解决/修改内容）
- `DELETE /document-annotations/:id`（仅作者/管理员）
- 操作写 `document_events` 与 `audit_logs`。

### 2.2 版本对比（Redline）

- `GET /documents/:id/compare?with_document_id=`：
  - 对比标题/图号/版本/状态/文件名/大小/哈希/MIME/审批状态/修订说明/密级/下载策略/有效性/BOM/ECO/工单；
  - 返回 `file_changed`、字段级 changes、两侧批注数、两侧审批步骤。
- 前端“批注/对比”页签可选择同族版本并查看字段差异表。

> 说明：当前 Redline 为**元数据/文件哈希级差异**，不是图纸像素级叠加比对；像素级对比需接 CAD/PDF 渲染/差异引擎（列入边界）。

## 3. CAD/PDF 预览与转换

- 原生预览：PDF、图片、文本（已有，带水印/权限/审计）；
- 新增 `GET /documents/:id/conversion`：
  - 返回 MIME、原生预览能力、是否可转换、转换器配置、提示信息；
  - 支持环境变量 `DOCUMENT_CONVERTER_BIN` 接入外部 CAD/Office→PDF 转换器；
- 前端/下载页可依据该接口提示“当前服务器未配置转换器，请下载查看”；
- 当前服务器未安装 LibreOffice/CAD 转换工具，因此 Office/CAD **不做实际转换**，避免假装成功。

## 4. 分类分级与下载策略

`documents` 增加：
- `classification`：public/internal/confidential/secret；
- `download_policy`：allow/preview_only/watermark_only/no_print。

接口：
- `GET /documents/:id/classification`
- `PUT /documents/:id/classification`（仅 document:write，审计）

访问控制：
- `secret` 文档：仅管理员或持有 `document:secret`/`*` 权限可见；列表过滤、详情/下载/预览均校验；
- `preview_only`：下载返回 403，只允许在线预览；
- `watermark_only`：下载响应头带动态水印标识（用户@时间）；
- `no_print`：下载响应头 `X-No-Print: 1`。

前端“密级/下载”页签维护密级与策略。

## 5. 与 BOM/ECO/工艺/工单/质量联动

`GET /documents/:id/links` 返回：

- BOM 节点：图号/层级/物料/数量；
- ECO：变更单号/标题；
- 工单：工单号/状态；
- 关联工艺节点：同一 BOM 节点下的工艺节点（名称/状态）；
- 同族版本；
- 批注数。

反查接口（注册在 `/:id` 之前）：
- `GET /documents/by-bom/:bomNodeId`
- `GET /documents/by-eco/:ecoId`
- `GET /documents/by-work-order/:workOrderId`

前端“关联影响”页签展示 BOM/ECO/工单/工艺节点/同族版本/批注数。

## 6. 验证

| 项目 | 结果 |
|---|---|
| 新增 `tests/documentP1.test.js` | **3/3**：批注+版本对比、BOM/ECO/工单/工艺关联+反查、密级拦截+下载策略 |
| 既有文档回归 | `documentControl` 2/2、`documentSecurity` 9/9、`documentChain` 6/6、`documentService` 10/10 |
| 全量部署闸门 | **909/0** ✅ |
| 前端 eslint / vue-tsc / build:safe | 0 / 0 / 通过（已部署） |
| 生产 API | annotations/compare/links/classification/conversion/by-bom 均 200 |
| Playwright | 受控抽屉 7 个页签正常；无 pageerror |

## 7. 当前生产状态

- 5 条文档：默认 `internal` + `allow`，无批注；
- 文档示例已关联 BOM 节点（如 `50主板` → BOM `TBM-1-2026-001`）；
- 未配置 CAD/Office 转换器，转换接口明确返回不可转换；
- 密级/下载策略默认不改变现有下载行为。

## 8. 已知边界

1. Redline 为元数据/哈希级，未做图纸像素级叠加对比；
2. CAD/DWG/STEP、Office 文档转换需外部转换器（当前服务器未安装），仅提供接入点与提示；
3. 批注坐标已存储，但前端尚未在预览画布上叠加批注标记（当前列表维护）；
4. `secret` 密级目前只区分管理员/授权，没有按项目/部门细分配置；
5. 下载水印仅响应头标识，未在 PDF/图纸文件内嵌水印；
6. 关联质量记录仅通过 BOM/工单间接体现，未直接挂检验/ITP 记录；
7. 按 BOM/ECO/工单反查未支持分页（上限 200 条）。

## 9. 复验方式

1. `https://192.168.1.73/documents` → Ctrl+Shift+R；
2. 任一文档“受控” → “批注/对比”：添加批注、选择同族版本对比；
3. “密级/下载”：设置绝密+仅在线预览，用普通账号验证不可下载；
4. “关联影响”：查看 BOM/ECO/工单/工艺节点；
5. `GET /api/documents/:id/conversion` 查看转换能力；
6. `node --test tests/documentP1.test.js`。
