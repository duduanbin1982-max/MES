# 文档/图纸 P1/P2 现场、供应商与治理实施报告

> 日期：2026-11-07  
> 范围：文档/图纸（`/documents`）  
> 目标：落地 P1/P2 四项：**现场移动端、供应商/外协协同、保留期/法律保留/归档、搜索与体验**。  
> 结果：核心能力已落地；新增回归 3/3；全量部署闸门 **912/0**。

## 1. 交付摘要

| 能力 | 交付 |
|---|---|
| 现场移动端 | 二维码/机号解析 `EQ:/BOM:/WS:/DOC:`；返回当前有效图纸/SOP/ITP/点检/其他；借阅/归还；现场问题拍照（图片 URL）反馈；离线队列 + 联网同步（幂等去重） |
| 供应商协同 | 文档关联供应商/采购单；供应商文档提交、审核（通过/驳回）、签收；按供应商/状态查询；到期提醒查询 |
| 保留期/法律保留/归档 | 保留期策略表；法律保留禁止物理清理；归档包 JSON + SHA-256 哈希、可校验；批量归档 |
| 搜索与体验 | 标签/版本/密级/日期/全文检索；分面统计；相关文件；按 BOM/ECO/工单反查；批量签发/归档；前端筛选与现场/治理抽屉 |

## 2. 现场移动端

### 2.1 二维码/扫码

`GET /documents/scan/:code` 支持：

- `EQ:<instance_id>` 或机号：按设备实例返回当前生效（已签发/归档 + 有效日期 + 密级可见）文档；
- `BOM:<bom_node_id>`：按 BOM 节点返回文档；
- `DOC:<doc_id>`：直接打开单个文档；
- `WS:<code>`：识别工位（当前返回工位信息，工位关联文档待接入工单工序）。

返回按 `drawing / sop / itp / checklist / other` 分组，前端“现场扫码”页签展示。

### 2.2 借阅/归还/现场问题

- `POST /documents/:id/borrow`、`POST /documents/:id/return`；`GET /documents/borrowings?status=open` 查未归还；
- `POST /documents/:id/field-issues`：现场问题批注（内容、页码、坐标、最多 10 张图片 URL），写入批注并留事件/审计；
- 前端现场页签可直接“借阅/归还/现场问题”。

### 2.3 离线缓存与同步

- 前端离线队列存 `localStorage`（`tbm_doc_offline`），记录 `client_action_id/doc_id/action`；
- `POST /documents/offline-sync`：批量提交签收/批注；`client_action_id` 幂等去重（`document_offline_actions` 表），重复返回 `duplicate`；
- 联网后一键“同步”。

> 当前为 Web 端离线队列，不是完整 PWA/Service Worker 离线包；扫码入口为输入/扫描枪，未接手机摄像头扫码 SDK。

## 3. 供应商/外协协同

`documents` 增加：`supplier_id / purchase_order_id / supplier_status / supplier_comment / supplier_reviewed_at / supplier_reviewed_by`；新增 `supplier_document_acks`。

接口：

- `PUT /documents/:id/supplier`：关联供应商与采购单，状态 `submitted`；
- `POST /documents/:id/supplier/review`：审核通过/驳回 + 意见；
- `POST /documents/:id/supplier/ack`：供应商签收登记；
- `GET /documents/supplier?supplier_id=&status=`：供应商文档列表；
- `GET /documents/supplier-expiring?days=30`：按有效期到期提醒。

外发水印/权限/有效期/下载审计复用 P1 的 `classification/download_policy` 与下载审计；前端“供应商协同”页签维护关联、审核、签收。

> 当前供应商协同为“内部人员代操作”模式，无供应商独立登录/门户与供应商 token 签名；到期提醒仅查询接口，未接消息。

## 4. 保留期、法律保留与归档

- `document_retention_policies`：按文档类型配置保留年限/法律依据（API 可维护）；归档时优先使用策略年限；
- `document_legal_holds`：`POST /documents/:id/legal-hold` 设置，`DELETE /document-legal-holds/:id` 解除；列表查询；
- **清理门禁**：`purgeOne` 检查 active 法律保留，命中直接拒绝；保留期未到仍拒绝；管理员 force 也不能绕过法律保留；
- `GET /documents/:id/archive-package`：返回文档、事件、审批、批注、法律保留 + `package_hash`（SHA-256）；
- `GET /documents/:id/archive-package/verify?hash=`：重算哈希校验归档包未被篡改；
- `POST /documents/batch/archive`：批量归档。

> 归档包当前为 JSON 清单 + 哈希，不含原始文件打包 ZIP；未接冷存储/对象存储分层。

## 5. 搜索与体验

- 列表查询扩展：`tag / version / classification / uploaded_from / uploaded_to / sort`；`q` 扩展到标题、编码、文件名、文档名、描述、标签、BOM 图号、机号；
- `GET /documents/facets`：按类型/状态/密级/标签统计；
- `GET /documents/:id/related`：同 BOM/同机号/同编码/同标签相关文件；
- `GET /documents/by-bom|by-eco|by-work-order/:id` 反查；
- `POST /documents/batch/issue|batch/archive` 批量签发/归档；
- 前端工具栏“现场扫码”，每行“治理”，筛选新增标签/版本/密级；
- 现场/治理抽屉含现场扫码、供应商协同、法律保留/归档三个页签。

> 未实现：缩略图墙、收藏/最近访问持久化、BOM 树直接挂文件入口、批量下载 ZIP、大文件断点续传（现有文件哈希去重）。

## 6. 验证

| 项目 | 结果 |
|---|---|
| 新增 `tests/documentEnterprise.test.js` | **3/3**：扫码/借阅/离线同步；供应商关联/审核/签收/到期；法律保留/归档哈希/相关/批量 |
| 既有文档回归 | `documentP1` 3/3、`documentControl` 2/2、`documentSecurity` 9/9、`documentChain` 6/6、`documentService` 10/10 |
| 全量部署闸门 | **912/0** ✅ |
| 前端 eslint / vue-tsc / build:safe | 0 / 0 / 通过（已部署） |
| 生产 API | scan/borrowings/supplier/supplier-expiring/facets/retention/legal-holds/archive-package 均 200 |
| Playwright | 现场/治理抽屉 3 页签正常；无 pageerror |

## 7. 当前生产状态

- 5 条文档默认未关联供应商、无法律保留；
- `EQ:1` 扫码可返回当前实例有效文档（当前文档均为 draft，故分组可能为空，签发后可见）；
- 归档包可生成并校验哈希；
- 保留期策略为空，使用文档类型默认年限。

## 8. 已知边界

1. 离线为 Web 本地队列 + 幂等同步，未做 PWA/Service Worker 离线包与冲突合并；
2. 扫码为输入/扫描枪，未接摄像头扫码 SDK；
3. 工位 `WS:` 只识别工位，未按工单工序展开该工位应看文件；
4. 供应商协同为内部代操作，无供应商门户/登录/token；
5. 到期提醒仅接口，未接邮件/企微；
6. 法律保留只阻止清理，不阻止下载/预览；
7. 归档包为 JSON 清单+哈希，非文件 ZIP；未接冷存储；
8. 缩略图墙、收藏/最近、批量下载 ZIP、大文件断点续传未实现；
9. 相关文件推荐为规则匹配（BOM/机号/编码/标签），非智能推荐。

## 9. 复验方式

1. `https://192.168.1.73/documents` → Ctrl+Shift+R；
2. 工具栏“现场扫码” → 输入 `EQ:1` 或 `BOM:10` 查询；
3. 文档行“治理” → 供应商协同关联/审核/签收；法律保留/归档包；
4. 筛选标签/版本/密级；调 `/api/documents/facets` 查看分面；
5. `node --test tests/documentEnterprise.test.js`。
