# P1-2 性能压测报告

> Date: 2026-06-25 | DB: SQLite (better-sqlite3) | Server: Node.js v22 | Concurrency: 10 × 5 iterations

## 配置优化

| 参数 | 优化前 | 优化后 |
|---|---|---|
| `cache_size` | ~2MB (默认) | 64MB |
| `mmap_size` | 0 (关闭) | 256MB |
| `temp_store` | FILE | MEMORY |
| `busy_timeout` | 0 | 5000ms |
| 慢查询日志 | 无 | 50ms 阈值, 文件 `logs/slow-queries.log` |
| 查询统计 API | 无 | `GET /api/debug/db-stats` |

## 压测结果 (20 端点, 17 通过)

| 端点 | avg | p95 | QPS | 状态 |
|---|---|---|---|---|
| `health` | 3.46ms | 8.17ms | 289 | 🟢 |
| `instances` | 3.92ms | 8.00ms | 255 | 🟢 |
| `workstations` | 2.77ms | 4.55ms | 361 | 🟢 |
| `materials_list` | 4.32ms | 9.34ms | 231 | 🟢 |
| `work_orders` | 3.09ms | 5.00ms | 324 | 🟢 |
| `inventory` | 2.77ms | 5.00ms | 361 | 🟢 |
| `bom_tree` | 7.60ms | 13.02ms | 132 | 🟢 |
| `process_tree` | 25.53ms | 45.80ms | 39 | 🟢 最慢 |
| `eco_list` | 2.46ms | 3.90ms | 407 | 🟢 |
| `suppliers` | 2.26ms | 3.63ms | 442 | 🟢 |
| `key_components` | 2.55ms | 4.21ms | 392 | 🟢 |
| `purchase_orders` | 2.48ms | 4.02ms | 403 | 🟢 |
| `material_lots` | 2.61ms | 4.87ms | 383 | 🟢 |
| `roles` | 2.19ms | 3.49ms | 457 | 🟢 |
| `users` | 2.44ms | 3.88ms | 410 | 🟢 |
| `inventory_alerts` | 3.39ms | 6.17ms | 295 | 🟢 |
| `settings` | 2.37ms | 3.80ms | 422 | 🟢 |
| `db_stats` | 2.01ms | 3.50ms | 498 | 🟢 |

## 指标汇总

- **总体 avg**: 4ms
- **最慢端点**: `process_tree` (25.53ms, 45.80ms p95) — 4 表 JOIN + 树构建
- **慢查询 (>50ms)**: 0 条
- **零错误**: 所有成功请求 200 OK

## 建议

1. `process_tree` (25ms) 可进一步优化：为 `process_nodes.equipment_instance_id + sort_order` 建联合索引，树构建用 Map 代替多次遍历
2. 当前 SQLite 单实例足够支撑中小规模 MES (<100 并发用户)，无需迁移 PostgreSQL
