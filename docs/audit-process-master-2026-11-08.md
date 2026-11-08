# 工序/岗位配置模块审计报告

> 日期：2026-11-08  
> 模块：`/process-master`（工序库 / 岗位库 / 派工校验）  
> 代码：`services/processMaster/*`、`shared/assignmentValidation.js`、`frontend/src/views/ProcessMaster.vue`  
> 结论：**存在 2 个 P0 配置缺口、5 个 P1 问题、4 个 P2 问题；本轮已修复 7 项，P0 数据缺口需业务补录。**

## 1. 审计范围与方法

- 代码审计：工序/岗位 CRUD、工序文档绑定、套用模板、派工校验、权限、审计日志、迁移；
- 数据审计：生产库 `process_positions`、`process_operation_templates`、`process_operation_docs`、`process_nodes`、`worker_skills`、`worker_certificates`；
- 运行时审计：生产 API、前端 `/process-master` 页面、Playwright 实际点击；
- 回归验证：`tests/processMaster.test.js`、`tests/assignmentValidation.test.js`、全量部署闸门。

## 2. 生产现状（审计时）

| 项目 | 数量 | 说明 |
|---|---:|---|
| 岗位 | 7 | 全部启用 |
| 工序模板 | 8 | 全部启用；均 `sop_required=1` |
| 工序文档绑定 | **0** | 8 个模板全部“要求 SOP 但未绑定 SOP” |
| 工艺节点 | 245 | 其中已套模板/已绑岗位 122；**未配置 123（50.2%）** |
| 节点模板/岗位孤儿引用 | 0 | 引用完整性正常 |
| 模板文档 | 0 条 | 生产未配置任何 SOP/图纸/WPS 绑定 |
| 人员技能/证书 | 部分缺失 | 无 machining/assembly/commissioning 技能；welding 证书为 expired |

### 关键证据：派工校验实际被 SOP 缺口拦截

生产调用 `POST /api/process-master/validate-assignment`：

```text
node 137（焊接，模板 welding，sop_required=1）
user 4（王师傅，welding 技能 L5）
结果：
{
  "ok": false,
  "missing": [
    "工序模板要求 SOP，但尚未绑定必需文档",
    "缺少有效 welding 资质证书"
  ]
}
```

即：即使人员技能满足，当前 8 个模板也都会因为“要求 SOP 但未绑定文档”而无法通过派工校验。

## 3. 问题清单

| 编号 | 级别 | 问题 | 证据/影响 | 本轮处理 |
|---|---|---|---|---|
| F-01 | **P0** | 8/8 工序模板要求 SOP，但 `process_operation_docs` 为 0 | 所有已套模板节点的派工校验被拦截，生产派工受阻 | 新增健康度告警 + 工序文档管理界面；**数据需业务补录** |
| F-02 | **P0** | 245 个工艺节点中 123 个未配置模板/岗位（50.2%） | 一半节点仍走手工配置，标准工序/资质要求不生效 | 健康度接口与页面告警；**数据需逐项配置** |
| F-03 | P1 | 工序文档只能在 API 绑定，前端无入口 | 管理员无法在页面维护必需 SOP/图纸，导致 F-01 长期存在 | **已修复**：工序行“文档”按钮 + 绑定/解绑弹窗 |
| F-04 | P1 | 岗位编码可被 API 修改，未做引用保护 | 生产 UI 禁用了编码编辑，但 API 可改；会与模板/节点的 `position_code` 形成孤儿或 500 | **已修复**：后端禁止修改岗位编码 |
| F-05 | P1 | 停用岗位仍可通过派工校验 | `shared/assignmentValidation` 只校验技能/证书，未校验 `process_positions.is_active` | **已修复**：停用岗位/停用模板加入 missing 原因 |
| F-06 | P1 | `drawing_required` 生产全部为 0，与种子默认值不一致 | 迁移 `INSERT OR IGNORE`/加列默认值未回填历史行；6 个模板本应要求图纸 | 记录为遗留；不擅自改生产数据 |
| F-07 | P2 | 工序文档更新可制造重复绑定 | 创建时查重，更新时未查重；同一工序/类型/文档可重复 | **已修复**：更新时排除自身查重 |
| F-08 | P2 | 只读角色无法用“派工校验” | 页面只要求 `process:read`，校验 POST 走 `process:write`，只读用户 403 | **已修复**：校验接口允许 `process:read` |
| F-09 | P2 | 前端加载/保存/校验异常无提示 | `loadAll/saveOperation/savePosition/validateAssignment` 未捕获异常，失败无反馈 | **已修复**：统一错误提示 |
| F-10 | P2 | 套用模板保留旧工位 | `required_workstation_id = COALESCE(旧值, 新值)`，切换模板可能保留不匹配工位 | 记录为遗留，建议“覆盖/保留”显式选项 |
| F-11 | P3 | 编码大小写可产生逻辑重复 | `toCode` 保留大小写，SQLite 唯一约束区分大小写 | 未处理，建议统一小写或 `COLLATE NOCASE` |
| F-12 | P3 | 主数据无分页 | 当前 7/8 条规模可接受；增长后需分页 | 未处理 |

## 4. 本轮已落地整改

### 4.1 后端

- **岗位编码不可变**
  - `PUT /process-master/positions/:code` 若提交不同 `position_code` → 400；
  - 避免模板/节点外键孤儿。
- **停用岗位/模板拦截派工**
  - `shared/assignmentValidation` 增加 `position_active`、`template_active` 校验；
  - 返回明确缺失原因：“岗位 X 已停用”“工序模板已停用”。
- **工序文档更新查重**
  - `PUT /process-master/operations/:id/docs/:docId` 更新时排除自身查重，重复绑定 409。
- **文档表存在性判断修正**
  - `assertDocument` 原逻辑无论表是否存在都继续查询；改为真实判断，避免缺表 500。
- **新增配置健康度接口**
  - `GET /api/process-master/health` 返回：
    - 未配置节点数；
    - 要求 SOP/图纸但未绑定文档的模板数；
    - 未绑定/未签发必需文档数；
    - 停用岗位引用、孤儿引用；
    - `issues[]` 供前端展示。
- **工序列表补充文档计数**
  - `doc_count` / `required_doc_count`。
- **权限**
  - `/process-master/validate-assignment` 允许 `process:read` 或 `process:write`。

### 4.2 前端

- 页面顶部新增**配置健康度告警**：
  - `NODES_UNCONFIGURED`：123 个节点未配置；
  - `SOP_WITHOUT_DOC`：8 个模板要求 SOP 但未绑定；
- 工序列表新增“文档”列（已绑定/必需）；
- 工序行新增“文档”按钮，打开工序文档弹窗：
  - 查看绑定、文档状态、是否必需；
  - 新增绑定（类型/标题/文档ID/必需）；
  - 解绑；
- 加载/保存/删除/校验失败统一 `ElMessage` 提示，避免静默失败。

## 5. 验证

| 项目 | 结果 |
|---|---|
| `tests/processMaster.test.js` | **12/12**（原 7 + 新增 5：岗位编码保护、引用删除拦截、停用岗位拦截、文档重复绑定、健康度） |
| `tests/assignmentValidation.test.js` | 通过（含旧库无 `is_active` 列兼容） |
| 全量部署闸门 | **920/0** ✅ |
| 前端 eslint / vue-tsc / build:safe | 0 / 0 / 通过（已部署） |
| 生产 API | `/process-master/health` 200：`unconfigured=123`、`sop_without_doc=8` |
| Playwright | 页面健康告警显示；`文档` 按钮打开“工序文档 · 下料”；无 pageerror |

生产健康度返回：

```json
{
  "nodes": { "total": 245, "unconfigured": 123, "no_template": 123, "no_position": 123 },
  "templates": { "total": 8, "sop_without_doc": 8, "drawing_without_doc": 0 },
  "documents": { "total": 0 },
  "issues": [
    { "code": "NODES_UNCONFIGURED", "severity": "warning", "count": 123 },
    { "code": "SOP_WITHOUT_DOC", "severity": "error", "count": 8 }
  ]
}
```

## 6. 必须由业务/管理员补录的 P0 项

1. **为 8 个工序模板绑定必需 SOP 文档**
   - 在 `/process-master` → 工序库 → 行“文档”；
   - 优先绑定 WPS、下料/焊接/装配/检验 SOP；
   - 文档必须已签发，派工人员必须签收，否则校验仍会拦截。
2. **配置 123 个未配置工艺节点**
   - 在工艺树/工艺路线中为节点套用工序模板并绑定岗位；
   - 或明确标记为“非标准/临时节点”，不要长期留空。
3. **补齐人员技能与证书数据**
   - 当前无 machining/assembly/commissioning 技能记录；
   - welding 证书状态为 expired；
   - 否则即使模板配置完整，派工校验仍会拦截。
4. **确认 `drawing_required` 口径**
   - 生产 8 个模板全为 0，但种子默认 6 个模板要求图纸；
   - 需业务确认是否应补为 1，再通过配置修正（不要直接改库）。

## 7. 遗留风险

1. 套用模板时旧工位会被 `COALESCE` 保留（F-10）；
2. 岗位/工序编码大小写可能产生逻辑重复（F-11）；
3. 健康度目前只在页面展示，未接入日报/告警；
4. 工序文档弹窗使用文档 ID 绑定，未做文档选择器；建议后续接文档搜索选择；
5. 本轮未修改生产数据，因此 P0 数据缺口仍然存在，页面会持续告警。

## 8. 复验方式

1. `https://192.168.1.73/process-master` → Ctrl+Shift+R；
2. 顶部查看健康度告警：123 未配置节点、8 个缺 SOP 模板；
3. 工序库任一行 → 文档 → 绑定一个已签发 SOP → 保存；
4. `GET /api/process-master/health` 确认 `sop_without_doc` 下降；
5. 派工校验页用真实人员/节点验证；
6. `node --test tests/processMaster.test.js tests/assignmentValidation.test.js`。
