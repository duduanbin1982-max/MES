# TBM-MES Architecture Rules

> 目的：把 Brooks 审计发现的结构问题转成日常开发约束。新增功能必须优先遵守本文件，而不是继续把业务逻辑塞回大 service 或大 Vue 页面。

## 1. 分层方向

标准依赖方向：

```text
frontend/views -> frontend/api
routes         -> useCases / services
useCases       -> repositories / domain / eventBus
repositories  -> db
domain         -> 不依赖 express / middleware / db / Vue
```

禁止方向：

- `domain` 不能 `require('../db')`、`require('express')`、`require('../middleware/*')`。
- `useCases` 不能直接挂 Express route。
- `routes` 不能承载复杂业务规则，只做参数解析、权限守卫、调用 use case、返回响应。
- `frontend/views` 不直接拼复杂状态机规则；复杂状态使用 `frontend/domain/*` 或后端返回的状态目录。

## 2. 后端模块结构

新闭环功能优先采用：

```text
services/<boundedContext>/
  index.js             # register(app, db)，只装配路由
  routes.js            # HTTP 适配，可选
  useCases/            # 业务用例：状态迁移、闭环动作、跨模块协调
  repositories/        # SQL 读写，唯一接触 db 的地方
  readModels/          # 看板/列表聚合查询
  domain/              # 状态、规则、值对象
```

单文件 service 超过 350 行必须拆分；超过 500 行禁止继续加新功能。

## 3. 前端页面结构

Vue 页面按“容器 + Tab + Dialog + composable”拆：

```text
views/Foo.vue          # 页面容器：选项卡、共享加载、路由参数
views/foo/FooTab.vue   # 单个业务 tab
views/foo/FooDialogs.vue
composables/useFoo.ts  # 页面内可复用数据加载/动作
```

单个 `.vue` 文件超过 350 行必须拆 tab 或 dialog；超过 700 行禁止新增业务块。

## 4. Workflow 规则

跨模块闭环只能通过 workflow/use case 协调，不能互相直接改表：

- 缺料关闭/重开：`ShortageWorkflow`
- BOM 风险消警/回流：`BomRiskWorkflow`
- 采购跟催状态流转：`PurchaseFollowupWorkflow`
- 项目风险卡片刷新：`DeliveryRiskWorkflow`
- NCR/CAPA 闭环：`QualityWorkflow`

Workflow 可以发布事件；订阅方更新自己的 read model。

## 5. DB 与测试 seam

- 新代码必须显式接收 `db` 或 repository，禁止在业务函数内部 `require('../db')`。
- 兼容旧入口可以暂时保留，但必须标注迁移目标，并不得在新调用点使用。
- 单元测试优先使用内存库或 fake repository，不依赖生产 `data/mes.db`。

## 6. 状态目录

状态值必须集中在 domain/status catalog：

- 后端：`app/domain/statusCatalog.js` 或各 bounded context 的 `domain/status*.js`
- 前端：`frontend/src/domain/statusCatalog.ts`

禁止在多个页面或 service 中各自硬编码同一状态机。

## 7. 验收闸门

每次结构调整后必须通过：

```bash
bash scripts/run-all-tests.sh
cd frontend && npm run build
curl -sk https://127.0.0.1/api/health
```

通过后再重启服务并确认 `/api/health`。
