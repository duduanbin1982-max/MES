# 工位/资源配置模块审计报告

> 日期：2026-11-08  
> 模块：`/workstation-resources`（工位配置）、`/resources`（资源分配与状态）  
> 代码：`services/resourceService/*`、`frontend/src/views/WorkstationResources.vue`、`ResourceDashboard.vue`、`views/resources/*`  
> 结论：**发现 2 个 P0（容量口径失效、分配接口绕过容量）、8 个 P1、5 个 P2；本轮修复 11 项，生产数据/工位容量口径仍需业务确认。**

## 1. 审计范围

- 工位 CRUD、工位类型/容量/技能/状态；
- 人员工位分配、释放、可用状态；
- 资源分配接口与分配历史；
- 资源概览、占用率、容量、告警；
- 生产数据一致性、API、前端页面、权限、审计。

## 2. 生产现状（审计时）

| 项目 | 数值 | 说明 |
|---|---:|---|
| 工位 | 9 | 全部 `is_active=1` |
| 工位类型 | 7 类 | assembly/welding/machining/inspection/cutting/forming/commissioning |
| 人员 | 7 | 3 人绑定工位，全部 `availability='online'` |
| 忙碌人员 | 0 | 容量校验只统计 busy，因此实际未生效 |
| 活动分配记录 | 1 条 | `user_id=4`，`workstation_id=NULL`，长期未释放 |
| 工位 `max_workers` | 全部 1 | 但 `capacity_per_day` 从 1 到 50 不等 |
| 工位 `status` | 全部 available | 实际有 3 个工位已绑定人员，状态未同步 |
| 资源概览 occupied | 审计前 0 | 只统计 busy，漏掉 3 个 online 占用工位 |

## 3. 问题清单

| 编号 | 级别 | 问题 | 影响 | 本轮处理 |
|---|---|---|---|---|
| F-01 | **P0** | 容量校验只统计 `availability='busy'`，生产已分配人员全是 `online` | 工位容量形同虚设，可无限塞人 | **已修复**：busy + online 都计入，排除本人 |
| F-02 | **P0** | `POST /resources/allocations` 完全绕过容量/停用校验 | 资源分配接口可绕过工位容量 | **已修复**：统一容量/工位状态/引用校验 |
| F-03 | P1 | 工位创建/更新无 station_type/status/数值校验 | 可写入非法类型、状态、负数容量 | **已修复**：统一 payload 校验 |
| F-04 | P1 | 工位编码重复检查区分大小写 | `WS-001` / `ws-001` 可并存 | **已修复**：`LOWER(code)` 查重 |
| F-05 | P1 | 有人员占用的工位可直接停用 | 人员被“挂”在停用工位 | **已修复**：有人员时拒绝停用 |
| F-06 | P1 | 分配人员不校验 equipment_instance/work_order | 可挂不存在的设备/工单 | **已修复**：引用存在性校验 |
| F-07 | P1 | 前端“可用状态”选择器是死控件 | 选在线/忙碌不生效，分配接口固定 busy | **已修复**：分配接口接收 availability，前端传参 |
| F-08 | P1 | 工位/人员/分配变更无审计 | 无法追溯谁改了容量/工位/分配 | **已修复**：create/update/assign/release/availability/allocation 写审计 |
| F-09 | P1 | `overview.occupied` 只算 busy | 资源看板占用数长期为 0 | **已修复**：busy + online |
| F-10 | P1 | 工位页无法分配人员，只能去另一页 | 工位配置与人员分配割裂 | **已修复**：工位页增加“人员分配”入口 |
| F-11 | P1 | 前端保存失败无提示 | 保存/分配失败静默 | **已修复**：统一错误提示 |
| F-12 | P2 | `max_workers` 默认 1，与 `capacity_per_day` 不一致 | 9 个工位全部 max_workers=1，容量口径混乱 | 记录，需业务确认 |
| F-13 | P2 | 工位 status 不随占用自动更新 | 3 个工位有人员但 status=available | 记录；建议按容量/占用派生或定时同步 |
| F-14 | P2 | 存在长期 active 分配记录（workstation_id=null） | 分配历史与用户当前工位不一致 | 记录，需清理/释放 |
| F-15 | P2 | 工位列表无分页（9 条可接受） | 规模增长后需分页 | 未处理 |
| F-16 | P2 | 工位/人员状态双字段（is_active + status） | 停用/禁用语义重叠 | 未处理，建议统一 |
| F-17 | P3 | 分配历史无 UI 清理/关闭入口 | 只能通过释放人员间接释放 | 未处理 |
| F-18 | P3 | 资源页人员表格 6 列较窄 | 技能/工位信息展示拥挤 | 未处理 |

## 4. 本轮已落地整改

### 4.1 公共校验/容量

新增 `services/resourceService/helpers.js`：

- `validateWorkstationPayload`：编码/名称/类型/状态/日产能/人数上限/班次/标签统一校验；
- `capacityOf`、`assignedCount`、`assertCapacity`：**busy + online 都计入**，分配时排除本人；
- `getWorkstation`：校验工位存在、启用、非 disabled；
- `assertAvailability`：分配时只允许 busy/online；
- `assertOptionalReference`：设备实例/工单引用校验。

### 4.2 工位接口

`workstationRoutes`：

- 列表支持 `include_inactive=1`；
- 创建/更新统一校验，返回 201；
- 编码大小写不敏感查重；
- 有人员时禁止停用；
- 创建/更新写审计。

### 4.3 人员分配

`workerRoutes`：

- 容量按 `busy + online` 统计，排除本人；
- 接收 `availability`（busy/online）；
- 校验设备/工单引用；
- 分配/释放/状态变更写审计。

### 4.4 资源分配

`allocationRoutes`：

- 校验工位启用/非 disabled；
- 校验容量；
- 校验设备实例/工单；
- 更新用户工位和 availability=busy；
- 写审计。

### 4.5 资源概览/前端

- `overview.occupied` 改为 busy + online；
- 工位页增加“人员分配”按钮跳转 `/resources`；
- 工位页加载包含停用工位，状态筛选“停用”可用；
- 人员分配弹窗只允许 busy/online，并把 availability 传给后端；
- 工位保存、人员分配/释放失败统一提示。

## 5. 验证

| 项目 | 结果 |
|---|---|
| `tests/resourceService.test.js` | **6/6**（新增容量/移动本人/分配绕过/非法工位/停用保护/概览） |
| 全量部署闸门 | **931/0** ✅ |
| 前端 eslint / vue-tsc / build:safe | 0 / 0 / 通过（已部署） |
| 生产 API | workstations（含 inactive）/overview/workers/allocations 均 200；occupied 从 0 修正为 3 |
| Playwright | 工位页 9 条、人员分配入口可跳转；资源页人员弹窗可打开；无 pageerror |

## 6. 当前生产状态/必须处理

1. **容量口径**：9 个工位 `max_workers` 全为 1，但 `capacity_per_day` 1~50；需确认“人数上限”是否应为 capacity_per_day，或逐工位配置。
2. **工位状态**：3 个工位已绑定在线人员，但 status 全为 available；建议：
   - 占用时自动置 occupied；
   - 或在 UI 中用“利用率/人员数”判断，不单独依赖 status。
3. **历史分配**：存在 `user_id=4, workstation_id=NULL` 的 active 分配；需释放/补工位或关闭。
4. **人员状态**：生产 3 名已分配人员是 online，不是 busy；需明确：
   - 在线即占用？本轮已按 online 计入容量；
   - 还是只有 busy 才占用？如只算 busy，必须把已分配人员改为 busy，否则容量永远空闲。
5. **工位编码/状态**：建议统一 `is_active` 与 `status` 的语义，避免双字段冲突。

## 7. 遗留

1. 工位列表无分页（当前 9 条）；
2. 工位 status 不自动同步占用；
3. 分配历史无关闭/清理按钮；
4. 资源页人员表信息密度偏高；
5. `max_workers` 与 `capacity_per_day` 业务口径未定；
6. 本轮未修改生产工位/人员/分配数据。

## 8. 复验

1. `https://192.168.1.73/workstation-resources` → Ctrl+Shift+R；
2. 确认工位清单 9 条，点击“人员分配”进入 `/resources`；
3. 点击人员行，选择工位/忙碌或在线，分配应校验容量；
4. 尝试把有人员的工位停用，应被拒绝；
5. `GET /api/resources/overview` 的 `workstations.occupied` 应为 3；
6. `node --test tests/resourceService.test.js`。
