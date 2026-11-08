# 工艺参数模块遗留问题修复报告

> 日期：2026-11-08  
> 模块：`/process-params`、`/process-master`（模板默认规格）、SPC 读取链路  
> 范围：审计报告“六、遗留”全部 6 项  
> 结果：6 项全部修复；processParams 10/10、processMaster 13/13；全量部署闸门 **927/0**。

## 1. 修复清单

| 遗留问题 | 处理结果 |
|---|---|
| 参数列表无分页/时间范围 | 后端支持 `page/page_size/from/to`；前端 50 条/页 + 日期范围 + 总数/翻页 |
| 趋势图异常静默吞掉 | 趋势加载失败显示告警 + “重试”；切换节点清理旧图表 |
| `/spc/analyze` 权限 quality:read | 增加精确规则：`quality:read` 或 `process:read`；`/spc/nodes-with-params` 同步放开 |
| monitor / deviations 前端未接 | 新增“过程监控”“参数偏差”两个页签，支持刷新、查看参数 |
| 规格未按工序模板带默认值 | 工序模板新增 `default_specs_json`；节点无自定义规格时自动回退模板默认；规格弹窗可勾选“同时保存为工序模板默认规格” |
| 规格读取逻辑分散 | 新增 `shared/processSpecs.js`，params/spcService/spcMonitor/processMaster 统一使用 |

## 2. 分页与时间范围

### 后端

`GET /api/process_nodes/:id/params` 新增：

- `page`、`page_size`（1~200）；
- `from`、`to`（`YYYY-MM-DD`）；
- 带分页/日期参数时返回：
  ```json
  { "items": [], "total": 351, "page": 1, "page_size": 50, "from": null, "to": null }
  ```
- 不带参数时保持原数组兼容。

### 前端

- 参数表格改为分页模式，默认 50 条/页；
- 支持 20/50/100/200 页大小；
- 增加日期范围筛选；
- 显示“共 351 条参数；当前第 1 页”；
- 记录新参数后回到第 1 页。

## 3. 趋势异常提示

- `renderTrends` 失败时设置 `trendError`，页面显示告警与“重试”按钮；
- 切换节点/实例时清理旧 ECharts 实例；
- 不再静默吞异常。

## 4. SPC 权限

新增精确权限规则（优先于通用 `/spc` 规则）：

```text
GET /spc/analyze              → quality:read 或 process:read
GET /spc/nodes-with-params    → quality:read 或 process:read
```

工艺参数页面用户即使没有 quality:read，也能运行 SPC 分析。

## 5. 过程监控 / 参数偏差页签

`/process-params` 新增：

### 过程监控

- 数据来源：`GET /process/monitor`；
- 展示节点/工序/类型/状态/机号/最近参数/参数数/未确认 SPC 报警；
- 可按当前选中实例过滤；
- “查看参数”可跳转到节点参数页并加载该节点。

### 参数偏差

- 数据来源：`GET /process/deviations`；
- 展示工序、参数、实测值、LSL/USL、超上限/超下限、偏差量、记录时间；
- 支持刷新；
- “查看参数”跳转节点。

## 6. 工序模板默认规格

### 数据模型

`process_operation_templates` 新增：

```text
default_specs_json TEXT
```

存储格式：

```json
{ "spc": { "temperature_c": { "lsl": 180, "usl": 280, "target": 230 } } }
```

schemaVersion：

- `process`：2 → 3
- `processMasterService`：1 → 2

### 读取优先级

```text
节点自定义规格（process_params.custom_json.spc）
        ↓ 没有
工序模板默认规格（process_operation_templates.default_specs_json）
        ↓ 没有
空规格
```

`GET /api/process_nodes/:id/params/specs` 返回 `source: node / template`，前端显示规格来源。

### 维护入口

- 工艺参数页“规格设置”弹窗；
- 若当前节点有工序模板，显示“同时保存为工序模板默认规格（模板 #id）”；
- 保存时：
  1. 写节点规格；
  2. 勾选时同时写 `PUT /api/process-master/operations/:id/specs`。

### 工序模板接口

```text
GET /api/process-master/operations/:id/specs
PUT /api/process-master/operations/:id/specs
```

## 7. 统一规格读模型

新增 `shared/processSpecs.js`：

- `PARAM_FIELDS / PARAM_LIMITS`
- `normalizeSpecs`（物理范围、LSL≤USL、target 区间、unit）
- `parseSpecsJson`
- `findNodeSpecRow`
- `getTemplateDefaultSpecs`
- `resolveNodeSpecs`（节点→模板回退）

改造：

- `services/process/params.js`
- `services/spcService.js`
- `services/spcMonitor.js`
- `services/processMaster/operationRoutes.js`

规格查找统一为：

```sql
ORDER BY recorded_at DESC, id DESC LIMIT 50
```

消除 `params.js` 20 条 / SPC 50 条、按 id / 按时间的差异。

## 8. 验证

| 项目 | 结果 |
|---|---|
| `tests/processParams.test.js` | **10/10**（新增分页/时间范围、模板默认回退） |
| `tests/processMaster.test.js` | **13/13**（新增模板默认规格） |
| `tests/assignmentValidation.test.js` | 6/6 |
| 全量部署闸门 | **927/0** ✅ |
| 前端 eslint / vue-tsc / build:safe | 0 / 0 / 通过（已部署） |
| 生产 API | 分页 params、specs（source=node）、template specs、monitor、deviations 均 200 |
| Playwright | 节点 #134：50 行/页 + 分页 + 351 总数；过程监控/参数偏差页签可切换；规格弹窗来源显示；无 pageerror |

## 9. 当前生产状态

- 生产参数仍为 754 条，覆盖 3/245 节点，最新记录 2026-06-26；
- 本轮未修改生产参数/规格数据；
- 工序模板默认规格目前为空，需要业务在规格弹窗勾选保存，或后续在工序模板页维护；
- 监控/偏差页签已可用，但数据取决于采集覆盖。

## 10. 仍需业务处理

1. 参数覆盖率仍是 1.2%，需扩大采集节点；
2. 数据停滞 4 个多月，需恢复采集；
3. 工序模板默认规格需补录；
4. 96 条历史 SPC 报警需确认/关闭；
5. 记录人真实化（管理员 603 条）；
6. `monitor` 只取在制/待开工前 100 节点，`deviations` 最多 500 条，后续可按需分页。

## 11. 复验

1. `https://192.168.1.73/process-params` → Ctrl+Shift+R；
2. 选 `TBM-2026-001` → 节点 `#134 总装`；
3. 确认 50 行/页、分页、351 总数、日期筛选；
4. 切“过程监控”“参数偏差”页签；
5. 打开“规格设置”，查看来源；对模板节点勾选“同时保存为工序模板默认规格”；
6. 用无 quality:read 的工艺用户运行 SPC；
7. `node --test tests/processParams.test.js tests/processMaster.test.js`。
