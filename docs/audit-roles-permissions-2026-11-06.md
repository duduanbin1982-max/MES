# 角色与权限模块审计报告

> 审计对象：角色管理 / 权限矩阵 / 角色组（页面入口：`/users` 的「角色组」「角色」「权限矩阵」页签）  
> 审计日期：2026-11-06  
> 审计方式：代码走读（`routes/roles.js` 268 行 + `services/userManagement.js` 角色组/用户 380+ 行 + `app/permissions.js` + 权限缓存/中间件）+ 生产接口实测 + 权限矩阵安全演练  
> 生产数据：角色 11 个、权限码 38 个（17 个资源）、角色组 8 个

## 0. 结论摘要

**整改前评级：C+** —— 角色 CRUD/权限矩阵/审计/缓存刷新都已具备，但存在 **2 个 P1 权限治理缺口**：

- **权限矩阵可清空 admin 的 `*`** → 下次登录后全系统没人有 `user:admin`，**永久锁死**；
- **非 admin 角色可以拿到 `*`**（超级权限可被复制/伪造），且**权限码不做目录校验**（未知码静默入库）。

**整改后：A（2 个 P1 + 3 个 P2 + 3 个 P3 全部已修）**

| 编号 | 级别 | 问题（整改前实测） | 状态 |
|---|---|---|---|
| R-1 | **P1** | `PUT /roles/admin/permissions []` 返回 200，可清空 admin 超级权限 → 系统锁死；同时任意角色可被授予 `*`（`PUT /roles/audit_probe/permissions ['*']` → 200） | 已修 |
| R-2 | **P1** | 权限码不校验：`POST /roles` 带 `evil:code` → 201 静默入库，权限矩阵"看起来授权了、实际不生效" | 已修 |
| R-3 | P2 | 内置角色可删除（未被引用时，如 `sales`），破坏内置角色语义 | 已修 |
| R-4 | P2 | 角色组创建无校验：`group_code='Bad Code'`、`default_role_code='nope'`、`data_scope='galaxy'` 全部 200 入库 | 已修（含存量脏数据迁移） |
| R-5 | P2 | 角色组创建/修改**不写审计**（角色侧已写，组侧缺失） | 已修 |
| R-6 | P3 | 角色组无删除接口；权限目录分组标签英文；无权限变更审批流；历史角色组 planner/administrator 冗余 | **已全部修复**（删除接口 / 中文标签 / 双人复核 / 历史组停用） |

## 1. 模块现状（走读）

```
角色与权限（/users 页签）
├─ 角色：GET/POST /api/roles、PATCH/DELETE /api/roles/:code
├─ 权限矩阵：PUT /api/roles/:code/permissions（写 audit_logs + reload 内存缓存）
├─ 权限目录：GET /api/permissions/catalog（PERMISSIONS 常量，38 码/17 资源）
├─ 角色组：GET/POST /api/role-groups、PATCH /api/role-groups/:id
└─ 编码建议：GET /api/roles/suggest-code、/api/role-groups/suggest-code
```

已有能力：角色编码不可改（防审计断链）、删除角色前校验用户/角色组引用、权限写入后刷新内存缓存、角色权限变更写审计、内置角色 `admin` 不可删、角色权限变更会强踢该角色用户（上一轮用户管理整改）。

## 2. 发现与整改明细

### R-1（P1）admin 超级权限可被清空 / 任意角色可拿 `*`

实测（整改前）：

```
PUT /api/roles/admin/permissions {"permissions":[]}       → 200（admin 变成零权限）
PUT /api/roles/audit_probe/permissions {"permissions":["*"]} → 200（非 admin 拿到超级权限）
```

后果：清空 `admin` 后，全系统没有任何角色拥有 `user:admin`，**无法再恢复权限矩阵**（除非改库）；而 `*` 可任意下发会让"角色"变成绕过权限矩阵的后门。

整改：
- `validateRolePermissions(permissions, roleCode)`：只有 `role_code='admin'` 允许 `*`；
- `assertAdminKeepsSuper('admin', perms)`：admin 必须保留 `*`，否则 400；
- 创建角色（含 `copy_from`）与 `PUT permissions` 全部走同一校验；
- 前端权限矩阵：非 admin 角色禁止打开「超级权限」开关；admin 角色禁止关闭；保存前二次拦截。

实测（整改后）：

```
PUT /api/roles/admin/permissions {"permissions":["work_order:read"]}
  → 400「内置 admin 角色必须保留 * 超级权限，不能移除」，DB 仍为 ["*"]
PUT /api/roles/audit_role/permissions {"permissions":["*"]}
  → 400「只有内置 admin 角色可以拥有 * 超级权限」
```

### R-2（P1）权限码不校验

原实现 `normalizePermissions` 只做去重排序，未知码（`evil:code`）与未知资源（`unknown:*`）都会入库；权限矩阵保存后"看似成功"，但 `apiPermissions` 永远匹配不到 → 排障困难、也容易被用来伪造"已授权"假象。

整改：校验对象为 `app/permissions.js` 的 `PERMISSIONS` 目录：
- 精确码必须在目录中；
- `resource:*` 的资源必须存在（17 个已知资源）；
- 单角色权限上限 500 项。

实测：`evil:code` → 400「未知权限码」；`unknown:*` → 400「未知权限资源」；`work_order:*` 合法通过。

### R-3（P2）内置角色可删除

`BUILTIN_ROLES` 仅用于列表展示，删除接口只拦 `admin` 和被引用角色。`sales` 等内置角色在无引用时可以被删掉，破坏内置语义（且 `DEFAULT_ROLE_PERMISSIONS` 回落逻辑会让人误以为角色还在）。

整改：删除顺序调整为「先查用户引用 → 再查角色组引用 → 最后拦内置角色」，内置角色返回 400「内置角色不能删除（可调整其权限或改用自定义角色）」。实测 `sales` → 400；自定义角色删除 200。

### R-4（P2）角色组无入参校验

实测（整改前）：`POST /api/role-groups {group_code:'Bad Code', default_role_code:'nope', data_scope:'galaxy'}` → **200**；`PATCH` 默认角色存在性也不校验。

整改（创建/局部更新共用 `validateRoleGroupInput`）：
- `group_code`：`^[a-z][a-z0-9_]{1,31}$`（小写字母开头，2–32 位）；
- `group_name`：必填、≤50 字；
- `default_role_code`：必须存在（或为空）；
- `data_scope`：必须是 `app/dataScope` 白名单；
- `default_home`：必须以 `/` 开头的站内路径、≤200；
- `scope_config`：字符串必须是合法 JSON；
- 创建时 trim 编码/名称。

实测：脏数据组合 → 400 并返回逐项错误；合法创建 → 200；PATCH 不存在的默认角色 → 400。

存量数据：`scripts/migrate-role-governance.js --apply` 规范化 1 条脏编码：`Production Supervisor → production_supervisor`；并校验 admin 保留 `*`、报告未知权限码（0 项）。

### R-5（P2）角色组无审计

整改：`role_group.create` / `role_group.update` 写 `audit_logs`（before/after 快照、操作人/IP/UA、diff_summary）。实测演练产生 create=1、update=1。

### R-6（P3，记录）

1. 角色组没有 DELETE 接口（只能 `is_active=0` 停用），无法彻底清理历史组；
2. 权限目录分组标签当前为英文资源名（如 `work_order`），可补中文标签；
3. 权限矩阵变更无审批流/双人复核（当前靠审计留痕 + admin 单点操作）。

## 3. 验证

| 项目 | 结果 |
|---|---|
| `tests/roleGovernance.test.js`（新） | **5/5**（admin 保留 `*` / 非 admin 禁止 `*` / 未知码 / 内置角色保护 / 角色组校验与审计 / 权限目录） |
| 既有 `tests/roles.test.js` | 10/10（测试夹具权限码同步为目录内权限） |
| 全量部署闸门 | **814/0** ✅ |
| 前端 eslint / vue-tsc / build | 0 / 0 / 通过 |
| 生产迁移 | 角色组编码规范化 1 条；admin `*` 校验通过 |

生产演练（真实 API，整改后）：

```
未知权限码 → 400「未知权限码: evil:code」
非 admin 授予 * → 400「只有内置 admin 角色可以拥有 * 超级权限」
移除 admin 的 * → 400，DB admin 仍为 ["*"]
合法通配 work_order:* 创建 → 201；自定义角色删除 → 200
角色组脏数据 → 400（group_code / default_role_code / data_scope 三项逐项报错）
合法角色组创建 → 200；PATCH 不存在默认角色 → 400；PATCH 合法 → 200
删除内置角色 sales → 400「内置角色不能删除」
角色组编码：production, warehouse, quality, engineering, purchase, administrator,
            production_supervisor, planner（脏编码已规范化）
审计：role_group.create=1、role_group.update=1
```

## 6. P3 遗留全修（2026-11-07）

### 6.1 角色组删除接口

- 新增 `DELETE /api/role-groups/:id`：`user_count > 0` 返回 409「角色组正在被 N 个用户使用，不能删除」；无引用可彻底删除；
- 写审计 `role_group.delete`（before 快照）；
- 前端角色组列表操作列新增「删除」按钮（确认弹窗）；
- 历史冗余组 `planner` / `administrator`：由 `scripts/migrate-role-group-cleanup.js --apply` **停用**（`is_active=0`，可逆、不破坏历史引用），确认无用后可用新接口彻底删除。

### 6.2 权限目录中文标签

- `RESOURCE_LABELS` 映射 17 个资源：`work_order → 工单管理`、`work_report → 工时报工`、`shopfloor → 车间工作台`、`user → 用户与权限` 等；
- 权限矩阵/权限目录页「模块」列直接显示中文（实测 `work_order=工单管理`）。

### 6.3 权限矩阵变更双人复核

- 新表 `permission_change_requests`（role_code / before_json / after_json / requested_by / status / reviewed_by / review_note）；
- `PUT /api/roles/:code/permissions` 行为：
  - 存在**另一名启用 admin** → 返回 202 `{pending:true, request_id}`，权限不立即生效；
  - 系统只有一名管理员 → 直接生效，审计标注「唯一管理员，直接生效」；
  - `PERMISSION_CHANGE_REQUIRE_APPROVAL=false` 可整体关闭（默认开启）；
- 审批 API：`GET /api/permission-change-requests?status=pending`、`POST .../:id/approve`、`POST .../:id/reject`（驳回必须填原因）；
- 申请人不能审批自己的变更（400）；审批通过后重新校验权限目录/admin `*` 保护，生效并强踢该角色用户；
- 审计：`role.permission.request` / `role.permission.approve` / `role.permission.reject`；
- 前端权限矩阵页：顶部显示「N 条权限变更待另一名管理员审批」+ 通过/驳回；保存时提示「已提交审批」或「已更新」。

**生产演练**（临时角色 + 临时第二管理员，已清理）：

```
提交变更（双管理员在线）→ 202 {pending:true, request_id:1}
申请人自审 → 400「不能审批自己提交的变更」
第二管理员通过 → 200，tmp_role 权限更新为 ['work_order:read','work_report:read']
再次申请 → 第二管理员驳回 → 200，权限保持不变
删除临时角色/临时管理员 → 200；历史组 planner/administrator active=0
```

## 7. P3 验证

| 项目 | 结果 |
|---|---|
| `tests/roleGovernance.test.js` | **7/7**（新增：角色组删除/审批双人复核/中文标签） |
| `tests/roles.test.js` | 10/10 |
| 全量部署闸门 | **816/0** ✅ |
| 前端 eslint / vue-tsc / build | 0 / 0 / 通过 |
| 生产迁移 | permission_change_requests 表已创建；planner/administrator 已停用（用户数 0） |

### 7.1 剩余边界（记录）

1. 权限变更审批流为**两级**（申请人 → 另一管理员），无多级/超时自动通过；
2. 权限申请无站内/IM 通知（需管理员主动打开页面查看）；
3. 历史角色组选择「停用」而非删除（保留可逆性），彻底清理需管理员在页面确认删除；
4. 权限目录仅分组标签中文化，动作（read/write/admin）仍为代码英文。

## 4. 改动文件

| 文件 | 说明 |
|---|---|
| `routes/roles.js` | 权限码目录校验、admin `*` 保护、非 admin 禁 `*`、内置角色删除保护、导出校验函数 |
| `services/userManagement.js` | 角色组入参校验（编码/默认角色/范围/home/JSON）+ 创建/更新审计 |
| `frontend/src/composables/useUserManagementPage.ts` | 权限矩阵超级权限开关保护（admin 必须保留、非 admin 禁止） |
| `frontend/src/views/UserManagement.vue` | 角色组编码填写提示 |
| `scripts/migrate-role-governance.js` | admin `*` 修复 + 角色组编码规范化 + 未知权限码报告（幂等） |
| `tests/roleGovernance.test.js` | 5 个回归用例 |
| `tests/roles.test.js` | 测试夹具权限码改为目录内合法码 |
| `scripts/migrate-role-group-cleanup.js` | 审批表创建 + 历史角色组停用（幂等） |
| `docs/audit-roles-permissions-2026-11-06.md` | 本报告 |

## 5. 复验方式

```bash
node --test tests/roleGovernance.test.js
node --test tests/roles.test.js
node scripts/migrate-role-governance.js --apply   # 幂等
```

前端：`/users` → 权限矩阵页签 → Ctrl+Shift+R：
- admin 角色：关闭「超级权限」应被拦截；
- 普通角色：打开「超级权限」应被拦截；
- 角色组弹窗：组编码填 `Bad Code`、默认角色选不存在值应被后端拒绝并提示。
