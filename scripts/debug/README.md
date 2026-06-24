# scripts/debug/

2026-06-22 brooks-lint R1 Critical 修复时，从仓库根目录移入。

## 内容

| 文件 | 用途 | 是否可删 |
|------|------|---------|
| `check-mes.js` | 早期 MES 自检脚本（v1 时期） | ✅ 可删 |
| `check-schema.js` | schema 对账工具 | ✅ 可删 |
| `_cols.js` | 探索 columns 的临时工具 | ✅ 可删 |
| `dry-run-subsystem.js` | subsystem 分类 dry-run | ⚠️ 保留以备 schema 变更时复用 |
| `inspect_*.js` (×11) | v1→v2 期间排查用的临时探针 | ✅ 全部可删 |
| `migrate-backfill-subsystem.js` | 一次性 backfill 迁移脚本（已 idempotent 跑过） | ⚠️ 保留以备回滚 |

## 使用

```bash
cd /home/dubin/factory-mes
node scripts/debug/<name>.js   # 大部分需要 factory-mes 服务在跑（读 db.js）
```

## 清理

每季度评审一次：本目录文件 ≥ 30 个时考虑批量归档到 `archive/debug-snapshot-YYYYMM/`。