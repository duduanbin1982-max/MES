# 人员资质模块审计报告

> 日期：2026-11-08  
> 模块：`/labor`「劳动力管理（资质·技能·工时）」  
> 代码：`services/laborService.js`、`frontend/src/views/LaborDashboard.vue`  
> 结论：**发现 2 个 P0（schema 漂移、资质数据一致性）、6 个 P1、4 个 P2；本轮修复 10 项，新增回归 4 条，全量闸门 935/0。**

## 1. 审计范围

- 证书：建档、续证/编辑、到期失效、按人员/类型/状态/临期查询；
- 技能：技能矩阵、等级/年限/持证标记、重复技能 upsert；
- 培训：培训记录、通过率、发证标记；
- 派工资质校验 `/labor/validate-assignment`；
- 用户证书摘要 `users.cert_no/cert_type` 一致性；
- API 权限、审计日志、生产数据一致性、前端页面。

## 2. 生产现状（审计时）

| 项目 | 数值 | 说明 |
|---|---:|---|
| 证书 | 7 | 5 有效、2 已过期 |
| 临期证书（30 天） | 0 | 无近期到期 |
| 技能 | 12 | 5 名人员 |
| 培训 | 8 | 全部通过，发证字段缺失 |
| 在册人员 | 6 | — |
| 证书缺到期日 | 2 | 视为长期有效 |
| `worker_training.certificate_issued` | **不存在** | 旧表缺列，服务假设列存在会报错 |
| `worker_certificates.attachment_path` | **不存在** | 旧表缺列 |
| 用户证书摘要 | 与证书表不一致 | 用户 2/4 仍保留已过期证书摘要 |

### 关键数据不一致

- 用户 4（王师傅）：`welding` 证书已过期（2026-09-15），但 `worker_skills` 中焊接技能 `certified=1`；
- 用户 2（张主任）：`safety` 证书已过期，但 `users.cert_type='safety'`、`cert_no` 仍保留；
- 用户 3/4/5：`users.cert_type/cert_no` 只反映首次证书，不随续证/失效更新；
- 8 条历史培训 `certificate_issued` 默认为 0，无法区分“培训通过但未发证”与“未维护”。

## 3. 问题清单

| 编号 | 级别 | 问题 | 影响 | 本轮处理 |
|---|---|---|---|---|
| F-01 | **P0** | 旧库 `worker_training` 缺 `certificate_issued`、`worker_certificates` 缺 `attachment_path`；迁移只 CREATE IF NOT EXISTS，不补列 | 新代码查询/培训发证字段会 500 或功能不可用 | **已修复**：迁移 addColumn 兼容 |
| F-02 | **P0** | 证书/技能/用户摘要不一致：过期证书仍保留用户摘要、技能 certified 仍为 1 | 派工/资质判断可能误判，质量追溯失真 | 用户摘要已自动同步；技能标记仍为数据问题 |
| F-03 | P1 | 证书创建/更新/删除无输入校验、无审计 | 可写不存在人员、非法日期、任意状态；不可追溯 | **已修复**：校验+审计+409 重复 |
| F-04 | P1 | 证书删除无 404、删除后不更新用户摘要 | 静默成功、旧摘要残留 | **已修复** |
| F-05 | P1 | 技能 `INSERT OR REPLACE`、等级/年限不校验、certified 字符串真值 | 0 级变 1 级、负数年限、id 被替换 | **已修复**：upsert + 1~5/0~60 校验 |
| F-06 | P1 | 培训只有新增/查询，无 UI 新增、无编辑/删除、无发证字段 | 培训记录无法闭环 | **已修复**：迁移补列 + 前端新增/删除 + 后端 PUT/DELETE |
| F-07 | P1 | 证书无续证/编辑 UI；状态只能靠接口改 | 过期证书无法在页面续证 | **已修复**：续证/编辑弹窗 |
| F-08 | P1 | 写接口要求 `user:admin`，但前端对所有 `user:read` 显示添加/删除按钮 | 非管理员点击 403 | **已修复**：按 `canManage` 隐藏 |
| F-09 | P1 | `/labor/validate-assignment` 是 POST 但写路由要求 user:admin | 只读/班组长无法做资质校验 | **已修复**：允许 user:read |
| F-10 | P2 | 到期状态只在 dashboard/证书列表触发检查 | 状态可能滞后 | 已改为启动+列表+dashboard 检查 |
| F-11 | P2 | 前端工人技能按逗号 split JSON 字符串，显示错乱 | 工人技能看不全 | **已修复**：统一解析 |
| F-12 | P2 | 工时排行列用 `tasks`，后端返回 `report_count` | 任务数永远空 | **已修复** |
| F-13 | P2 | 培训通过率 `undefined%` | 无培训时显示异常 | **已修复** |
| F-14 | P2 | 证书/技能/培训均无分页 | 当前 7/12/8 可接受，增长后需分页 | 未处理 |
| F-15 | P3 | 证书附件列存在但 UI 无上传/下载 | 附件能力未落地 | 未处理 |
| F-16 | P3 | 派工校验只按固定 `work_type→cert_type` 映射，不校验技能等级/岗位 | 与实际工艺岗位资质模型不完全一致 | 记录，建议接 `shared/assignmentValidation` |

## 4. 本轮整改

### 4.1 Schema 兼容

`laborService.runMigration` 增加 `addColumn`：

- `worker_certificates.attachment_path`；
- `worker_training.certificate_issued INTEGER NOT NULL DEFAULT 0`；
- laborService schemaVersion 1 → 2。

### 4.2 证书

- 创建/更新校验人员存在且启用、日期格式、发证≤到期、状态枚举、证书编号重复；
- 创建/更新/删除写审计；
- 删除校验存在，返回 404；
- 证书变更后自动同步 `users.cert_no/cert_type` 为最新有效证书；
- 启动时 `checkCertExpiry` + `syncAllCertSummaries`，修正历史摘要。

### 4.3 技能

- 校验人员、技能名/分类、等级 1~5、年限 0~60、certified 布尔；
- 同人同技能改为 `UPDATE`（不再 INSERT OR REPLACE 丢 id）；
- 删除校验 404，操作写审计。

### 4.4 培训

- 校验人员、类型、日期顺序、学时/成绩范围、发证标记；
- 新增 PUT/DELETE 接口并写审计；
- 前端新增“添加培训”弹窗、删除操作、发证列。

### 4.5 前端

- 证书表增加“续证/编辑”；
- 根据 `user:admin` 隐藏管理按钮；
- 工人技能 JSON/逗号格式统一解析；
- 工时排行列改为 `report_count`；
- 培训通过率安全显示；
- 保留原有新增证书/技能流程。

## 5. 验证

| 项目 | 结果 |
|---|---|
| 新增 `tests/laborService.test.js` | **4/4**：证书摘要/到期、输入校验/重复/删除、技能 upsert/等级、培训增改删 |
| 全量部署闸门 | **935/0** ✅ |
| 前端 eslint / vue-tsc / build:safe | 0 / 0 / 通过（已部署） |
| 生产 API | dashboard/certificates/skills/training 均 200；旧表已补 `certificate_issued`、`attachment_path` |
| Playwright | `/labor` 证书 7 条、续证弹窗、培训添加弹窗、无 pageerror |
| 生产摘要修正 | 用户 2 过期 safety 摘要清空；用户 3 cad、用户 4 ndt、用户 5 ndt 取最新有效证书 |

## 6. 仍需业务处理

1. **技能 certified 标记与证书不一致**
   - 用户 4 焊接证书已过期，但焊接技能仍 `certified=1`；
   - 需按“技能-证书类型”建立映射或人工修正。
2. **历史培训发证标记**
   - 8 条培训记录 `certificate_issued=0`，需确认哪些实际发证；
   - 培训与证书未建立关联（training→certificate）。
3. **证书续证流程**
   - 页面已可续证，但需业务补录新到期日/新证书编号；
   - 建议续证时保留旧证历史（当前是覆盖同一行）。
4. **派工校验模型**
   - `/labor/validate-assignment` 仍是固定 work_type 映射；
   - 建议接入 `shared/assignmentValidation`（岗位/技能/必需文档/签收）。
5. **附件**
   - `attachment_path` 已补列，但无上传/预览入口。
6. **证书临期统计**
   - 页面“证书临期(30天)”不包含已过期证书；建议增加“已失效”指标。

## 7. 复验

1. `https://192.168.1.73/labor` → Ctrl+Shift+R；
2. 资质证书 tab：7 条、临期 0、2 条已过期；
3. 点“续证/编辑”修改到期日/状态并保存；
4. 技能矩阵 tab：12 条，等级 1~5；
5. 培训记录 tab：添加一条培训，勾选“已发证”，保存；
6. 用只读账号确认不显示添加/删除；
7. `node --test tests/laborService.test.js`。
