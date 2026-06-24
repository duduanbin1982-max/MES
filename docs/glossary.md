# TBM-MES 术语表 (Glossary)

> 2026-06-22 brooks-lint R6 修复：项目与设备实例命名分裂，统一约定。
>
> **铁律**：本系统内 `project` = `equipment_instance` 的中文业务术语别名。
> 三者指同一概念：客户订的一台盾构机。

## 核心约定

| 维度 | 统一术语 | 说明 |
|------|----------|------|
| 业务口语（中文） | **项目** | 杜斌、韩运机械内部沟通时使用 |
| 数据库表名 | `equipment_instances` | v2.1 schema 已统一到此；不要用 `projects` 表 |
| API 路径 | `/api/equipment_instances/...` | 现行实现 |
| 前端 URL/State | `instance` | 路由参数、store key |
| README 旧称 | "项目即产品实例（1 套 = 1 个项目）" | v2.1 重构前的口径，与上等价 |

## 易混项

- ❌ `routes/projects.js`：当前**未被 server.js 引用**，是 v1 时期的残余。db 里的"项目"实际存于 `equipment_instances` 表。
- ❌ "projects 表"：不存在；用 `equipment_instances` 代替。
- ❌ "project_id" 在前端 URL 里：用 `equipment_instance_id` 代替。

## 后续工作（已记录到 follow-up）

1. 重命名 `routes/projects.js` → `routes/equipmentInstances.js`，挂载到 `/api/equipment_instances`
2. 把 server.js 里所有 `/api/projects` 的 inline 路由移到上面的 router（brooks-lint R2 拆 4 模块的真正落地动作）
3. 前端 views/EquipmentInstances.vue 已经用正确术语，无需改动

## 为什么不直接改名？

| 方案 | 工作量 | 风险 |
|------|--------|------|
| 全表重命名 `equipment_instances` → `projects` | 半天（含 migration 011） | 高：影响 30+ 处 SQL、前端路径、备份脚本 |
| 路由重命名 `/api/projects` → `/api/equipment_instances` | 已完成（v2.1） | — |
| 写 glossary 让团队认知对齐 | 1 小时 | 极低 |

**选择**：glossary 先行，rename 留作 P1 阶段大重构时一起做（那时有充分测试保护 + 完整 CI）。