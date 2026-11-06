# 角色组模块审计报告

> 审计对象：角色组/部门（页面：`/users` → 「角色组」页签；数据范围继承链：角色组 → 用户覆盖 → 角色默认）  
> 审计日期：2026-11-07  
> 审计方式：代码走读（`services/userManagement.js` 角色组/批量归属、`app/dataScope.js` 继承逻辑、`routes/roles.js`）+ 生产接口实测 + 数据范围继承演练  
> 生产数据：角色组 8 个（启用 6 / 停用 2）、用户 7 个、其中 1 个用户归属角色组

## 0. 结论摘要

**整改前评级：C+** —— 角色组 CRUD、默认角色、数据范围继承链已成立，但存在 **1 个 P1 配置完整性缺口 + 4 个 P2 可用性/校验缺口**：

- **停用角色的组仍在参与数据范围继承**（`production` 组 `is_active=0` 但仍有用户挂靠，`loadScope` 不检查 `is_active`）；
- 重复 `group_code` 直接 **500 内部错误**；
- `scope_config` 只校验"是不是 JSON"，结构/键/类型不校验，配错会被静默丢弃 → 数据范围意外收紧（缺配置=拒绝）；
- 页面宣称"角色组负责批量归属"，但**没有批量归属接口**（404）；
- 用户弹窗可选择停用的角色组，后端也允许把用户挂到停用组。

**整改后：A-（1 个 P1 + 4 个 P2 已修，另补 2 项 P3）**

| 编号 | 级别 | 问题（整改前实测） | 状态 |
|---|---|---|---|
| RG-1 | **P1** | 停用组仍参与数据范围继承：`production` 组已停用（`is_active=0`）但 `foreman01` 挂靠并继承 `workshop/{subsystem_ids:[1]}`；停用组也能继续被用户继承 | 已修 |
| RG-2 | P2 | 重复 `group_code` → **500 INTERNAL_ERROR**（应 409 并提示） | 已修 |
| RG-3 | P2 | `scope_config` 无结构校验：`{"foo":[1]}`、`{"project_ids":["x"]}` 均 200 入库，被 `normalizeConfig` 丢弃后触发"缺配置→拒绝"，数据范围意外收紧 | 已修 |
| RG-4 | P2 | 无批量归属接口（页面副标题写着"批量归属"但 `assign-users` 404） | 已修 |
| RG-5 | P2 | 用户弹窗可选择停用组；后端 `createUser/updateUser` 也接受停用组 | 已修 |
| RG-6 | P3 | 列表无启用/停用人数区分、无排序；历史组 `planner/administrator` 停用状态不可见 | 已修（增加 active_user_count、启用优先排序） |
| RG-7 | P3 | 默认首页只校验"以 / 开头"，不校验路由是否存在；无组级成员查询接口 | 记录 |

## 1. 模块现状

```
角色组/部门（/users → 角色组）
├─ GET    /api/role-groups                  列表（含 user_count）
├─ POST   /api/role-groups                  新建（group_code/group_name/default_role_code/data_scope/scope_config/default_home）
├─ PATCH  /api/role-groups/:id              局部更新（含 is_active）
├─ DELETE /api/role-groups/:id              删除（有用户归属时 409；2026-11-06 P3 新增）
├─ GET    /api/role-groups/suggest-code     编码建议
└─ 批量归属（2026-11-07 新增）POST /api/role-groups/:id/assign-users

数据范围继承：users.data_scope（用户级覆盖）
             > role_groups.data_scope + scope_config（组继承）
             > 角色默认 all
作用实体：work_orders / qc_inspections / material_movements（按 scope 生成行级过滤；缺配置=拒绝）
```

## 2. 发现与整改明细

### RG-1（P1）停用组仍参与数据范围继承

实测：`production` 组 `is_active=0`，`foreman01` 仍挂在该组；`loadScope` 只查 `data_scope/scope_config`，不看 `is_active` → 停用组的数据范围继续生效；同时停用组可被继续分配用户（无任何校验）。

整改（三处收口 + 数据修复）：
1. **有用户的组不能停用**：`PATCH is_active=0` 时若 `user_count>0` → 409「角色组仍有 N 个用户，不能停用；请先调整用户归属」；
2. **停用组不能分配用户**：`assign-users` 400；`createUser/updateUser` 指定停用组 → 400「角色组已停用，不能分配用户」；
3. **继承兜底**：`loadScope` 查询 `is_active`，停用组直接忽略（不参与继承；兼容无 `is_active` 列的旧库）；
4. **数据修复**：`scripts/migrate-role-group-integrity.js --apply` 自动恢复"停用但仍挂用户"的组（生产已恢复 `production` 启用，`foreman01` 继承恢复正常）。

实测：创建挂 `production` 组的用户 → `/api/me/scope` = `workshop（按车间，role_group，subsystem_ids:[1]）`；停用组分配用户 → 400；有用户停用 → 409。

### RG-2（P2）重复 group_code 500

原实现依赖 DB 唯一约束，重复插入抛 SQLITE_CONSTRAINT 未转换 → 500。
整改：创建前预检 `group_code`，重复返回 409「group_code 已存在: xxx」。
实测：`POST group_code=production` → **409**。

### RG-3（P2）scope_config 结构校验

新增 `validateScopeConfig`：
- 只允许键：`project_ids / instance_ids / subsystem_ids / workstation_ids / locations`；
- ID 类必须为正整数数组；`locations` 必须为非空字符串数组；
- 字符串 JSON 先解析，非法 JSON → 400；
- 未知键 → 400 并列出支持键（避免"配了但被静默忽略"）。
实测：`{"foo":[1]}` → 400「scope_config 不支持的键: foo」；`{"project_ids":["x"]}` → 400「必须是正整数数组」；合法配置 → 200。

### RG-4（P2）批量归属接口缺失

新增 `POST /api/role-groups/:id/assign-users`：
- `user_ids` 必填、正整数、去重、单次 ≤200；用户必须存在；组必须启用；
- 事务内批量更新 `users.role_group_id`；写审计 `role_group.assign_users`；
- 返回 `assigned` 数量 + `role_mismatch`（用户角色与组默认角色不一致的清单，供前端提示）。
前端：角色组列表新增「分配用户」按钮 + 多选用户对话框（预选当前成员），归属后刷新组/用户列表并提示角色不一致数量。

实测：2 人批量归属 → 200 `{assigned:2, role_mismatch:[]}`；组 `user_count=2`；审计已写入。

### RG-5（P2）停用组可被用户选择/挂靠

- 后端：`createUser/updateUser` 校验组 `is_active=1`（RG-1 已含）；
- 前端：用户弹窗角色组下拉只显示 **启用中的组**（`activeRoleGroups`）。
实测：用户挂停用组 → 400。

### RG-6（P3）列表可用性

- 列表新增 `active_user_count`（启用用户数），并 `ORDER BY is_active DESC, id`（启用组优先）；
- 历史组 `planner/administrator`（上一轮 P3 已停用）在列表置底并显示停用标签。

### RG-7（P3，记录）

1. `default_home` 仅校验"以 / 开头的站内路径"，不校验前端路由是否存在（填错登录后 404）；
2. 无组级成员查询接口（前端用 `/users` 全量 + `role_group_id` 过滤，用户多时低效）；
3. 角色组无软删除/恢复（删除即物理删除，靠审计留痕）；
4. 默认角色变更不会批量调整已归属用户的角色（仅提示 mismatch，避免误改权限）。

## 3. 验证

| 项目 | 结果 |
|---|---|
| `tests/roleGovernance.test.js` | **11/11**（新增 RG-1/2/3/4/5 五个用例） |
| `tests/dataScope.test.js` | **10/10**（停用组兜底不破坏旧库兼容） |
| 全量部署闸门 | **820/0** ✅ |
| 前端 eslint / vue-tsc / build | 0 / 0 / 通过 |
| 生产迁移 | `production` 组恢复启用；用户角色/组默认角色不一致 0 条 |
| 现场演练 | 见下 |

现场演练（真实 API）：

```
production 组：active=1、users=1；挂组用户 /me/scope → workshop / role_group / subsystem_ids:[1]
重复 group_code → 409「group_code 已存在: production」
scope_config {foo:[1]} → 400；合法 {project_ids:[1], locations:['主仓库-A']} → 200
批量归属 2 人 → 200 {assigned:2}；组 user_count=2
有用户时停用 → 409「仍有 2 个用户，不能停用」
停用组分配 → 400；用户挂停用组 → 400
演练用户/临时组已清理
```

## 4. 改动文件

| 文件 | 说明 |
|---|---|
| `services/userManagement.js` | 重复 code 409、scope_config 结构校验、批量归属接口、停用/分配互斥校验、列表 active_user_count/排序、创建/更新用户拒绝停用组 |
| `app/dataScope.js` | 停用组不参与数据范围继承（兼容无 is_active 旧库） |
| `frontend/src/composables/useUserManagementPage.ts` | activeRoleGroups、批量归属对话框逻辑、用户弹窗仅启用组 |
| `frontend/src/views/UserManagement.vue` | 角色组「分配用户」按钮 + 对话框、scope_config 提示 |
| `scripts/migrate-role-group-integrity.js` | 恢复"停用但仍挂用户"的组、报告角色/组默认角色不一致（幂等） |
| `tests/roleGovernance.test.js` | 新增 RG-1~RG-5 用例 |
| `docs/audit-role-groups-2026-11-07.md` | 本报告 |

## 5. 复验方式

```bash
node --test tests/roleGovernance.test.js
node --test tests/dataScope.test.js
node scripts/migrate-role-group-integrity.js --apply   # 幂等
```

前端：`/users` → 角色组页签 → Ctrl+Shift+R：
1. 角色组列表：启用组在前、显示用户数（含启用人数）；`production` 应为启用；
2. 点「分配用户」→ 选择 2 个用户 → 归属成功，再点「编辑」把状态关掉应提示"仍有用户不能停用"；
3. 新建角色组：`group_code` 重复应提示"已存在"；范围配置填 `{"foo":[1]}` 应被拒并提示支持键；
4. 用户弹窗：角色组下拉不再出现停用组。
