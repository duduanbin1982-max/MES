# 文档链路深挖报告（上传 → 签发 → 签收 → 版本升级 → 收回）

> 审计日期：2026-11-05  
> 审计方式：代码走读（`services/documentService` 472 行 + 前端文档页）+ 生产数据核对 + 真实 API 生命周期探测  
> 相关：`docs/audit-batch-remaining-2026-11-05.md`（此前已修文档权限与上传孤儿文件）

## 0. 结论

**链路已修复并跑通（签发/签收/收回/版本链全部验证）**；发现 **2 个 P1 + 2 个 P2**，已全部整改。

| 项目 | 结果 |
|---|---|
| 生产文档 | 5 份，全部 `draft`（从未走过签发/签收，说明该链路长期未被使用，问题未暴露） |
| 关键验证 | draft 签收 → 400（原来 500）；draft 收回 → 400；版本链 A0/A1 互见；history family 包含全部版本 |
| 测试 | 新增 `tests/documentChain.test.js` **6/6**；既有文档测试 12/12 |
| 全量部署闸门 | **773/0** |

## 1. 链路现状（走读结论）

```
上传（POST /api/documents，raw body + X-Doc-Meta）
  → 草稿 draft
  → 签发（PUT /:id/issue，issued_to：assembly/welding/qc/...）
  → 签收（GET /pending-ack 待签收 → POST /:id/acknowledge，写 doc_acknowledgements）
  → 版本升级（同 doc_code family 上传 A1，/versions 聚合）
  → 收回（PUT /:id/revoke，原因 + revoked_at）
  → 归档（DELETE /:id → archived；文件保留）
```

每次动作写 `document_events`（上传/签发/签收/收回/归档），`/history` 按文档 family 汇总。

## 2. 发现与整改

| 编号 | 级别 | 问题 | 整改 |
|---|---|---|---|
| DOC-1 | **P1** | **签收接口 500**：`req.user.id` 在鉴权中间件里不存在（用户标识是 `uid`），`ack_by` 传 null → `NOT NULL constraint failed`；且**未校验文档状态**，草稿/已收回/已归档文档都能签收 | 改用 `req.user.uid`；仅允许 `status='issued'` 签收，其它返回 400；未登录返回 401 |
| DOC-2 | **P1** | **上传可绕过签发**：`meta.status` 直接写入，上传时传 `status=issued` 即为"已签发"，跳过 issue 流程（且 `issued_at` 用 ISO 格式，与其它 `datetime` 不一致） | 上传强制 `status='draft'`，`issued_*` 一律置空；签发只能走 `PUT /:id/issue` |
| DOC-3 | P2 | **生命周期无状态机**：已签发文档可重复签发（覆盖 issued_at）；草稿/已归档可"收回"；归档无幂等保护 | issue：仅 draft→issued，重复签发 400，归档/收回 422；revoke：仅 issued→revoked，草稿/归档 400；archive：幂等 |
| DOC-4 | P2 | **版本链断裂**：`doc_code` 带版本后缀（`ZZ-001-A0`、`ZZ-001-A1`），`/versions` 与 `/history` 按 `doc_code` 精确匹配 → 每个版本只看到自己，A0/A1 互不可见 | 新增 `documentFamilyBase()` 去掉版本后缀，versions/history 按 family 聚合（`doc_code = base` 或 `base-%`/`base_%`） |

### 2.1 修复前后对比（生产实测）

| 请求 | 修复前 | 修复后 |
|---|---|---|
| `POST /api/documents/29/acknowledge`（draft） | **500** INTERNAL_ERROR | **400** "只能签收已签发的文档（当前状态: draft）" |
| `GET /api/documents/29/versions` | 只有 A0 自己 | **A1 + A0** 两个版本 |
| `GET /api/documents/29/history` | `document_ids: [29]` | `document_ids: [29, 31]` |
| `PUT /api/documents/29/revoke`（draft） | 200 直接改成 revoked | **400** "只能收回已签发的文档" |

## 3. 测试覆盖（`tests/documentChain.test.js` 6/6）

1. 签发：draft→issued；重复签发 400；归档不可签发 422；
2. 收回：仅 issued→revoked；草稿收回 400；重复收回 400；
3. 签收：草稿 400；已签发成功；重复签收幂等（`already:true`）；`uid` 生效；
4. 版本链：A0/A1 双向可见（versions + history family）；
5. 归档：draft→archived 幂等；
6. 待签收列表：签收后自动移除。

## 4. 未整改 / 建议

| 编号 | 级别 | 说明 |
|---|---|---|
| DOC-5 | P3 | 收回/归档只改状态，**文件不删除**（设计如此，保留审计证据）；存储清理需单独策略 |
| DOC-6 | P3 | 签收人无角色限制：任何登录用户都可签收已签发文档（业务上可能只允许车间/质检角色签收） |
| DOC-7 | P3 | `doc_code` 无唯一约束、无版本序列校验（可跳版本、可重号） |
| DOC-8 | P3 | 无"签收率/超期未签收"统计报表（`/documents/stats` 仅文档数） |
| DOC-9 | P3 | 生产 5 份文档全部 draft——说明业务尚未启用签发链路，建议先跑一次真实签发/签收，验证通知与流程 |

## 5. 改动文件

| 文件 | 说明 |
|---|---|
| `services/documentService/acknowledgementRoutes.js` | `uid` 取用户、仅 issued 可签收、待签收列表 uid |
| `services/documentService/mutationRoutes.js` | 上传强制 draft；issue/revoke/archive 状态机 |
| `services/documentService/history.js` | `documentFamilyBase`、family 聚合 |
| `services/documentService/queryRoutes.js` | 版本列表按 family 聚合 |
| `tests/documentChain.test.js` | 新增 6 个用例 |

## 6. 复验方式

```bash
node --test tests/documentChain.test.js
curl -s -H "Authorization: Bearer $TOKEN" https://192.168.1.73/api/documents/29/versions   # 应含 A0+A1
```

前端：`/documents` → 详情 → 签发/签收/版本历史/收回/归档。
