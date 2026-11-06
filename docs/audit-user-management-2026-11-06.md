# 用户管理模块审计报告

> 审计对象：`/users`（用户与权限管理：用户 CRUD / 角色组 / 角色 / 权限矩阵 / 数据范围覆盖）  
> 审计日期：2026-11-06  
> 审计方式：代码走读（前端 `UserManagement.vue` 289 行 + `useUserManagementPage.ts` 327 行；后端 `services/userManagement.js` 328 行 + `routes/auth.js` / `routes/roles.js` / `middleware/auth.js` / `app/jwt.js`）+ 生产接口实测 + 安全场景演练  
> 生产数据：用户 7 个、角色 11 个、角色组 8 个、审计日志 560 条

## 0. 结论摘要

**整改前评级：C** —— 权限管理页功能完整（角色组/角色/权限矩阵/数据范围都有），但**账号生命周期安全存在 3 个 P1 缺口**：禁用/删除用户后旧 token 仍可用、可删除最后一个管理员、自助改密不校验原密码。

**整改后：A-（3 个 P1 + 3 个 P2 已修）**

| 编号 | 级别 | 问题（整改前） | 状态 |
|---|---|---|---|
| U-1 | **P1** | token 只验签不查用户：禁用/删除/改角色/改密码后旧 token 最长 1h 内仍可用；`/auth/refresh` 用旧 access token 可**无限续签**（即使已过期） | 已修 |
| U-2 | **P1** | 可删除当前登录账号、可删除/禁用/降级**最后一个启用管理员**（直接锁死系统）；可删除有工单/报工引用的用户造成悬空 | 已修 |
| U-3 | **P1** | 非管理员自助改密**不校验原密码**（token 泄露即可改密接管账号） | 已修 |
| U-4 | P2 | 用户创建/更新/删除/改密**不写审计**（角色权限变更已写，用户侧缺失） | 已修 |
| U-5 | P2 | 无密码策略（可建 1 位密码）、用户名无格式限制、大小写重复可绕过唯一约束 | 已修 |
| U-6 | P2 | 用户列表无搜索/分页，全量返回；页面无筛选，用户多时不可用 | 已修 |
| U-7 | P3 | 登录失败仅写 security logger，未进审计；无 MFA/会话设备管理 | 记录（触发条件：等保/多终端管理需求） |

## 1. 模块现状（走读）

```
用户与权限管理 /users
├─ 用户列表：GET /api/users（全量，无分页/搜索）
├─ 新建/编辑：POST /api/users、PATCH /api/users/:id
├─ 删除：DELETE /api/users/:id
├─ 角色组：GET/POST /api/role-groups、PATCH /api/role-groups/:id
├─ 角色：/api/roles（增删改 + PUT /api/roles/:code/permissions，已有审计 + 内置角色保护）
└─ 数据范围：/api/me/scope + 用户级覆盖（data_scope/data_scope_config）
```

认证链路：`POST /auth/login` 签发 JWT（payload 含 sub/role/permissions，**不含用户版本号**）→ `authMiddleware` 只验签 → `apiPermissionMiddleware` 按权限码放行。角色权限矩阵写库后会 reload 内存缓存，但**已签发 token 不失效**。

## 2. 发现与整改明细

### U-1（P1）账号禁用/删除/改角色/改密码后旧 token 仍有效

实测（整改前）：

- 禁用用户后，该用户原 token 继续访问 API（`authMiddleware` 只 `jwt.verify`，不查库）；
- `/api/auth/refresh` 的 access-token fallback 允许"过期但签名有效"的 token，重新签发新 token 且只从缓存取该角色权限 → **被禁用/删除的用户可无限续签**；
- 角色从 admin 降级后，旧 token 仍带 admin 权限直到 1h 过期。

整改（token 版本号方案）：

1. `users.token_version INTEGER NOT NULL DEFAULT 0`（迁移脚本 `scripts/migrate-user-governance.js --apply`，生产已执行）；
2. JWT 增加 `tv` claim；登录时写入当前版本；
3. `authMiddleware` 每次请求查 `users`（id / is_active / token_version / role_code）：用户不存在 → 401；禁用 → 401；`tv` 不一致 → 401；角色以数据库为准；
4. `handleRefresh` 同样校验存在/启用/版本，并用数据库当前角色重新取权限（旧 token 无法续签）；
5. 敏感变更后 `token_version + 1`：改密码、改角色、禁用/启用、角色权限矩阵变更（`PUT /roles/:code/permissions` 会强踢该角色全部用户）。

实测（整改后）：

```
禁用临时用户 → 200 {token_bumped:true}
禁用后旧 token 访问 → 401「账号已禁用，请联系管理员」
禁用后用旧 token 刷新 → 401（同上）
角色权限矩阵变更 → 该角色用户 token_version+1，旧 token 401
旧会话（token 无 tv 字段）→ 兼容放行（生产 admin 当前 token_version=0）
```

### U-2（P1）可删除自己/最后一个管理员；删除有引用用户

原 `DELETE /api/users/:id` 仅判断"是否 admin 调用"，无自我保护、无最后管理员保护、无引用检查。

整改：
- 不能删除当前登录账号；不能禁用当前登录账号；
- 不能删除/禁用/降级**最后一个启用状态的 admin**（`countActiveAdmins(excludeId)`）；
- 删除前检查业务引用：`work_orders.assigned_to`、`process_executions.operator_id`、`work_report_details.worker_id`，有引用则 409 并提示"改为禁用"；
- 所有用户写操作（create/update/delete/password change）写 `audit_logs`（含 before/after 脱敏快照，不含密码哈希）。

实测：

```
DELETE /api/users/1（自己）→ 400「不能删除当前登录账号」
PATCH  /api/users/1 {is_active:false} → 400「不能禁用当前登录账号」
DELETE 有工单引用的用户 → 409「存在关联业务记录…请改为禁用」
删除干净临时用户 → 200，audit_logs 写入 user.create / user.update / user.delete
```

### U-3（P1）自助改密不校验原密码

原逻辑：任何登录用户 `PATCH /users/:id {password}` 即可改自己密码（token 泄露 = 账号接管）。

整改：非 admin 自助改密必须提供 `old_password`，bcrypt 比对通过才允许；改密后 `token_version+1`（其他终端立即下线）。admin 重置他人密码不受此限（管理员职责），但同样记录审计。

### U-4（P2）用户 CRUD 无审计

整改：`user.create` / `user.update` / `user.delete` / `user.password.change` 写 `audit_logs`（操作人、IP、UA、before/after 脱敏对象、diff_summary）；角色权限变更原有审计保持，并补充"强制 N 名用户重新登录"说明。

### U-5（P2）无密码策略/用户名格式/大小写重复

整改：
- 密码 8–128 位（创建与更新都校验）；
- 用户名 `^[a-zA-Z0-9_.-]{3,32}$`，前后空格 trim；
- 重复检查改为 `LOWER(username)`（`Admin` 与 `admin` 视为同一用户）；
- `full_name` ≤64 字、`phone` ≤32 字。

实测：`Admin`（已有 admin）→ 400「username 已存在」；`audit_weak` + `123` → 400「密码长度至少 8 位」。

### U-6（P2）列表无搜索/分页

整改：
- `GET /api/users?q=&role_code=&is_active=&page=&page_size=`，返回 `{items,total,page,page_size}`（page_size 上限 200，默认 50）；
- 前端用户列表增加搜索框（用户名/姓名/手机）、角色筛选、状态筛选、总数提示、查询/重置按钮；
- 列表查询字段白名单（不返回 `password_hash`）。

实测：`GET /api/users?q=audit_tmp&page=1&page_size=10` → 200，`total=1`，返回不含密码哈希。

### U-7（P3，记录）

1. 登录失败仅 security logger，未写审计表（建议：连续失败锁定 / 登录审计）；
2. 无 MFA、无会话/设备管理（当前 token 1h + refresh 7d，靠 token_version 强踢）；
3. 角色组层面的"默认角色 + 数据范围继承"缺少可视化继承链（当前仅表格展示）。

## 3. 验证

| 项目 | 结果 |
|---|---|
| `tests/userGovernance.test.js`（新） | **8/8**（token 失效/刷新拒绝/自我保护/最后管理员/引用删除/审计/密码策略/搜索分页/权限矩阵强踢） |
| 全量部署闸门 | **809/0** ✅ |
| 前端 eslint / vue-tsc / build | 0 / 0 / 通过 |
| 生产迁移 | `users.token_version` 已新增（默认 0，旧 token 兼容） |
| 回归影响 | 修复 Express 4 参数中间件被误判为 error handler 的问题；`rbac` / `roles` / `workflowDefinitionsAuth` 全部恢复通过 |

生产演练（真实 API）：

```
创建 audit_tmp → 200；大小写重复 → 400；弱密码 → 400
禁用 audit_tmp → 200 {token_bumped:true}
禁用后旧 token → 401；旧 token 刷新 → 401
删除自己 → 400；禁用自己 → 400
搜索分页 → total=1，items=1，无 password_hash
删除临时用户 → 200；audit_logs: user.create=1 / user.update=1 / user.delete=1
```

## 4. 改动文件

| 文件 | 说明 |
|---|---|
| `services/userManagement.js` | 密码策略、大小写重复、token_version、最后管理员/引用/自我保护、审计、搜索分页、自助改密校验 |
| `middleware/auth.js` | authMiddleware 查库校验（存在/启用/tv）、handleRefresh 校验 |
| `app/jwt.js` | access token 增加 `tv` claim |
| `routes/auth.js` | 登录写入 tv；refresh fallback 传 db |
| `routes/roles.js` | 权限矩阵变更强踢该角色用户（含测试库容错） |
| `server.js` | `app.locals.db` 供 authMiddleware 使用（保持 3 参数 arity） |
| `scripts/migrate-user-governance.js` | 新增 `users.token_version` 迁移（幂等） |
| `frontend/src/composables/useUserManagementPage.ts` | 搜索/筛选/总数/重置、删除错误提示 |
| `frontend/src/views/UserManagement.vue` | 用户工具栏（搜索/角色/状态/总数）、密码 8 位提示 |
| `tests/userGovernance.test.js` | 8 个回归用例 |
| `services/registry/admin.js` | userManagement schemaVersion 3 → 4（DDL 指纹变更） |

## 5. 复验方式

```bash
node --test tests/userGovernance.test.js
node scripts/migrate-user-governance.js --apply   # 幂等
```

前端：`/users` → Ctrl+Shift+R → 搜索/筛选/分页；禁用用户后该用户下一次请求应 401（重新登录提示"账号已禁用"）；新建用户密码 <8 位应被拒。
