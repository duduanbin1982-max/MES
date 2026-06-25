# 文档/图纸管理 规范 (PLM 基础)

> MES 系统的 PLM 基础模块, 覆盖从设计 → 采购 → 生产 → 售后全链路的图纸/标准/SOP 集中管理。

## 1. 背景与目标

非标装备生产中, 图纸/SOP/工艺/质检标准散落在设计部 NAS、个人电脑、微信群里, 引发:

- **采购买错零件**: 没有图号/型号/材质/表面处理字段
- **装配缺料**: 没有 ECO 关联, 旧版未收回
- **成本核算对不上账**: 文档和 BOM/物料没有双向追溯
- **售后无备件**: 没有易损件标识 + 没有版本历史

本文档定义 MES 文档/图纸管理的**字段标准、状态机、版本控制、签发流程、ECO 追溯**。

## 2. 字段标准 (12 字段 + 4 级扩展)

### 2.1 基础标识 (3 字段)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | INTEGER PK | auto | 系统内部 ID |
| `title` | TEXT | ✓ | 文档标题, 例如 "机架总装图 A0" |
| `doc_code` | TEXT UNIQUE | ✓ | 文档编码, 例如 "ZZ-001-A0" |

### 2.2 数量属性 (3 字段)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | TEXT | ✓ | 版本号, 例如 A0/A1/B0, 与图纸版本一一对应 |
| `file_size` | INTEGER | auto | 字节 |
| `doc_type` | TEXT | ✓ | 类型枚举, 见 §3 |

### 2.3 技术要求 (2 字段)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_name` | TEXT | ✓ | 原始文件名, 例如 "jijia-A0.pdf" |
| `mime_type` | TEXT | ✓ | MIME, 例如 "application/pdf" |

### 2.4 管理追溯 (4 字段)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | TEXT | ✓ | 状态机, 见 §4 |
| `description` | TEXT | - | 描述/备注 |
| `tags` | TEXT(JSON) | - | 标签数组, 例如 ["易损件","关键件"] |
| `bom_node_id` | INTEGER FK | - | 关联 BOM 节点, 见 §5 |

### 2.5 4 级扩展 (按需启用)

| 字段 | 类型 | 启用场景 | 说明 |
|------|------|----------|------|
| `equipment_instance_id` | INTEGER FK | 装备级文档 | 关联设备实例 |
| `eco_id` | TEXT | 变更文档 | ECO 变更号, 例如 "ECO-2026-001" |
| `issued_to` | TEXT | 已签发 | 签发目标, 见 §6 |
| `revoke_reason` | TEXT | 已收回 | 收回原因 |

## 3. 文档类型 (7 类)

| 值 | 中文 | 图标 | 场景 |
|----|------|------|------|
| `drawing` | 图纸 | 📕 | 工程图/装配图/零件图 |
| `sop` | SOP 作业指导 | 📝 | 装配/焊接/调试 SOP |
| `process` | 工艺文件 | ⚙️ | 工艺路线/工序卡/工装清单 |
| `qc_std` | 质检标准 | ✅ | 检验规范/验收标准 |
| `contract` | 合同/技术协议 | 📄 | 采购合同/技术附件 |
| `report` | 试验报告 | 📊 | 厂内测试/型式试验 |
| `other` | 其他 | 📎 | 不属于以上 6 类的文档 |

## 4. 状态机

```
       ┌──────────┐
       │  draft   │ (草稿/上传后默认)
       └────┬─────┘
            │ PUT /:id/issue {issued_to}
            ▼
       ┌──────────┐
       │  issued  │ (已签发, 受控状态)
       └────┬─────┘
            │ PUT /:id/revoke {reason}
            ▼
       ┌──────────┐
       │  revoked │ (已收回, 旧版防错)
       └────┬─────┘
            │ DELETE /:id
            ▼
       ┌──────────┐
       │ archived │ (已归档, 历史保留)
       └──────────┘
```

- **draft**: 上传后默认状态, 仅作者/管理员可见编辑
- **issued**: 签发到目标部门, 进入受控状态, 用于生产/装配
- **revoked**: 旧版被收回, 替代新版, **不删数据** (追溯)
- **archived**: 软删除, 不出现在签发列表, 仅历史查询

## 5. 版本控制

### 5.1 版本号规则

- 字母 + 数字: `A0` (初版), `A1` (A 系列修订), `B0` (重大变更后重置)
- 与图纸版本号**一一对应**, 图改版, BOM 改, 文档也改
- 禁止 "图改了, 文档没改"

### 5.2 重复上传检测

`POST /api/documents` 时, 若 **同一 instance + 同一 file_hash + 同一 version** 已存在, 返回 `409 CONFLICT`。

避免同一文档被无意义重复上传。修改文件内容后 hash 变, 视为新版本 (需要新建 doc_code 或 BUMP version)。

### 5.3 版本历史

`GET /api/documents/:id/versions` 返回**同 doc_code 的所有版本** (按时间倒序), 用于:

- 追溯某文档的所有历史修订
- 下载历史版本 (售后/审计)

## 6. 签发目标 (8 类)

| 值 | 中文 | 用途 |
|----|------|------|
| `assembly` | 装配车间 | 装配 SOP/装配图 |
| `welding` | 焊接车间 | 焊接工艺/焊缝图 |
| `qc` | 质检部 | 检验标准/质检报告 |
| `warehouse` | 仓库 | 物料清单/收发规范 |
| `field` | 现场服务 | 现场装配手册/调试指南 |
| `design` | 设计部 | 设计规范/参考图册 |
| `procurement` | 采购部 | 采购合同/技术协议 |
| `management` | 管理层 | 试验报告/审批文件 |

## 7. ECO 追溯

### 7.1 关联字段

- `eco_id`: ECO 变更号, 关联到 `ecos` 表
- 设计变更后, **新文档**带 `eco_id="ECO-2026-001"`, **旧文档**被 `revoke`, 记录 `revoke_reason="ECO-2026-001 替代"`

### 7.2 查询路径

```
ECO 变更号 → 文档列表 (filter: eco_id)
旧文档 (status=revoked) → revoke_reason → 新文档 (同 doc_code, 新 version)
```

## 8. 存储

### 8.1 路径规则

`/data/uploads/yyyy/mm/<timestamp>_<random>.<ext>`

- 按月分目录, 单目录文件数可控
- 时间戳 + 随机串, 避免冲突

### 8.2 文件 hash

- SHA-256, 上传时计算
- 用于重复检测 + 完整性校验

## 9. API 端点

| 方法 | 路径 | 用途 | 权限 |
|------|------|------|------|
| GET | `/api/documents` | 列表 (支持 6 个 filter) | `equipment:read` |
| GET | `/api/documents/stats` | 统计 (状态/类型/总字节) | `equipment:read` |
| GET | `/api/documents/:id` | 详情 | `equipment:read` |
| GET | `/api/documents/:id/download` | 下载文件 | `equipment:read` |
| GET | `/api/documents/:id/versions` | 版本历史 | `equipment:read` |
| POST | `/api/documents` | 上传 (raw body + X-Doc-Meta) | `equipment:write` |
| PUT | `/api/documents/:id/issue` | 签发 | `equipment:write` |
| PUT | `/api/documents/:id/revoke` | 收回 | `equipment:write` |
| DELETE | `/api/documents/:id` | 软删 (归档) | `equipment:write` |

## 10. 前端页面

- 路由: `/documents`
- 菜单: 📑 文档/图纸 (icon: `FolderOpened`)
- 列表: 5 个 stat card + 6 维过滤 + 表格
- 操作: 上传/签发/收回/归档/下载/版本历史 (侧栏)
- 集成入口: BomManagement.vue 节点详情加 "图纸" tab (待办)

## 11. 数据库迁移

`db/migrations/024_documents.sql` — 在原 `documents` 表 (10 字段, 002 创建) 上 ADD 17 列 + 8 索引, 不重建表 (向后兼容)。

## 12. 测试覆盖

- 单测: `tests/documentService.test.js` — 8/8 ✅
  - validateMeta
  - 列表 + 过滤
  - 上传 + 重复检测
  - 签发/收回/归档
  - 版本历史
- 全量: `bash scripts/run-all-tests.sh` — **284/0/0** ✅
- E2E: 8 步 (登录→上传→签发→下载→收回→统计→归档) ✅

## 13. 未来扩展 (Backlog)

- [ ] BomManagement 节点详情加 "图纸" tab (`/api/documents?bom_node_id=N`)
- [ ] ECO 变更集成 (回滚旧版, 通知签发部门)
- [ ] 文档评论/批注 (现场反馈)
- [ ] 在线预览 (PDF/图片)
- [ ] 大文件分片上传 (突破 50MB 限制)
- [ ] OPL (单点课程) 关联