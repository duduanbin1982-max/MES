# 模块边界规则

> 建立日期：2026-11-02  
> 检查脚本：`scripts/check-module-boundaries.js`  
> 白名单：`config/moduleBoundaries.json`  
> 接入点：`scripts/run-all-tests.sh` 的 `0.4)` 步骤（部署闸门与 CI 都会跑）

## 1. 两条规则

| # | 规则 | 说明 |
|---|---|---|
| 1 | **跨域只读** | 服务只能写「自己拥有的表」。要读别人的数据，走 `v_*` 只读视图（见 `docs/read-model.md`）；要写别人的数据，走对方服务的接口/函数。 |
| 2 | **跨服务 require 白名单** | 服务之间默认不允许 `require` 对方的模块；确需共用时在 `config/moduleBoundaries.json` 登记并写原因。 |
| 3 | **跨域触发器受限** | 不允许在别人的表上建触发器（跨域副作用）；确需时登记 `allowedTriggers` 并写原因。 |

## 2. 表归属怎么判定

按**文件路径**判定，不按调用图（避免"被谁扫到就算谁的"导致归属漂移）：

```
services/<dir>/...            → 该 dir 只对应一个服务时归它；多个服务共用该 dir 则视为共享
services/<file>.js            → 仅当它是某服务的入口文件时归该服务
其它（含编号迁移建的表）        → 共享，不参与跨域写检查
```

因此：
- 编号迁移（`db/migrations/*.sql`）建的表 = **共享表**，任何服务都可以读写；
- 服务 DDL（`CREATE TABLE`）建的表 = **有主表**，只有主服务能写。

## 3. 白名单（必须写原因）

`config/moduleBoundaries.json`：

```json
{
  "allowedRequires": [
    { "from": "materialPlanner", "to": "material", "reason": "物料计划与物料主数据同域，共用 helper" }
  ],
  "allowedWrites": [
    { "from": "criticalPartsService", "to": "tbmAdvanced", "table": "critical_part_certificates",
      "reason": "registry 已声明 dependsOn: [tbmAdvanced]；表由 tbmAdvanced 建，关键件服务在其上扩展 document_id" }
  ],
  "allowedTriggers": [
    { "from": "equipment", "table": "process_nodes",
      "reason": "进度回写触发器：工序状态变化时自动重算 equipment_instances.progress_pct" }
  ],
  "sharedTables": []
}
```

- 每条都必须写 `reason`（测试会校验，防止"僵尸白名单"）；
- `from`/`to` 必须是 registry 里真实存在的服务名。

## 4. 当前基线（2026-11-02）

| 项 | 数量 |
|---|---|
| 服务 | 50 |
| 有明确归属的表 | 49 |
| 跨服务 require（已白名单） | 8 组 |
| 跨域写（已白名单） | 1 处（关键件证书表，registry 已声明依赖） |
| 跨域触发器（已白名单） | 2 处（equipment 在 process_nodes / work_orders 上建进度回写触发器） |
| 表归属冲突 | 0 |
| 动态 SQL（表名来自变量，无法静态判定） | 14 个文件 |

> 动态 SQL 只是提示，不判定违规。要根治就得把表名/列名改成常量拼接（后续可选）。

## 5. 常见问题

**Q：我要新增一个跨域查询怎么办？**
A：优先加只读视图（`services/reportService/schema.js` 或对应聚合模块的 readModel），不要在业务服务里直接 `SELECT` 别人的表。

**Q：确实需要跨服务 require 怎么办？**
A：在 `config/moduleBoundaries.json` 的 `allowedRequires` 加一条并写清原因，然后 `npm run boundary:check` 确认通过。

**Q：报"跨域写"但不该改代码？**
A：如果两个服务在同一域、且 registry 已有 `dependsOn` 声明，加 `allowedWrites` 并引用该依赖关系；否则应把写操作挪到对方的服务里。

**Q：能一次看全部违规明细吗？**
A：`node scripts/check-module-boundaries.js --verbose` 或 `npm run boundary:json`。

## 6. 与其它检查的分工

| 脚本 | 管什么 |
|---|---|
| `check-duplicate-routes.js` | 重复 API 路由 |
| `check-module-manifest.js` | 前端模块清单/菜单/路由一致性 |
| `check-service-schema-versions.js` | 服务 DDL 指纹与 schemaVersion |
| `check-layer-boundaries.js` | 分层依赖方向（services→routes、domain→infra 等） |
| **`check-module-boundaries.js`** | **服务之间的边界：跨域写 + 跨服务 require** |
