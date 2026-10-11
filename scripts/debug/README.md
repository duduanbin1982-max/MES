# scripts/debug/

**2026-10-11：本目录已清空。**

原有 12 个一次性排查脚本（`check-mes.js`、`check-schema.js`、`_cols.js`、
`inspect_*.js` ×9，共 64 处 `console.*`）按本文件旧版的分类表全部属于"✅ 可删"，
现已归档到：

```
/home/dubin/attic/debug-snapshot-2026-10/
```

仓库历史里仍可取回任意一个（`55d8081` 是归档前最后一个含这些文件的提交）：

```bash
git show 55d8081:scripts/debug/inspect_parts2.js
```

## 清空理由

| 问题 | 证据 |
|---|---|
| 依赖早已不存在的数据模型 | `inspect_parts3.js` / `inspect_parts4.js` / `inspect_parts6.js` 引用 v1 的 `main_structures` / `parts` / `bom`，实测已跑不通 |
| 硬编码业务数据 | 多数脚本写死具体节点 id（如 `WHERE parent_id = 134`）和绝对路径 `/home/dubin/factory-mes/data/mes.db` |
| 误跑有写库风险 | `check-mes.js` 与 `check-schema.js` 打开生产库时**没有 `readonly`** |
| 与统一日志口径冲突 | 全仓唯一一块"非服务、非测试"的 `console.*` 集中区 |

## 今后新增临时探针的口径

本目录继续保留（放 `README.md` 以便 git 跟踪），新加脚本请遵守：

1. **只读**：`new Database(path, { readonly: true })`；确实要写必须写明理由并自带 `dry-run` 开关；
2. **参数化**：不要硬编码业务 id / 绝对路径，从 `process.argv` 传；
3. **生命周期**：一次性脚本用完当次就删；确有复用价值的，在文件头注释写明适用场景，
   并纳入季度评审（本目录文件 ≥ 10 个时再次归档）。

## 长期保留的 scripts/ 是什么

`scripts/` 根目录下的脚本是**正式工具**，保留 `console.*` 输出（它们是 CLI / CI 产物，
不是服务日志，写 JSON 反而没法给人看）：

| 脚本 | 用途 |
|---|---|
| `check-duplicate-routes.js` | 部署闸门：路由重名检查 |
| `check-module-manifest.js` | 部署闸门：模块清单一致性 |
| `check-service-schema-versions.js` | 部署闸门：DDL 指纹与 schemaVersion |
| `check-layer-boundaries.js` | 部署闸门：分层依赖方向 |
| `pre-deploy-test.sh` / `run-all-tests.sh` | 部署闸门主体 |
| `backup-db.sh` / `wal-checkpoint.sh` / `offsite-backup.sh` / `restore-drill.sh` | 运维定时任务 |
| `recompute-safety-stock.js` | 安全库存重算（运维） |
| `benchmark.js` | 基准测试 |
