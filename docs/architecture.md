# Factory MES Architecture

> TBM-MES v2.3 (Phase 1: Equipment-Centric + Process Tree + Settings) — 2026-06-24
> Server: 192.168.1.73 (Node 22 + nginx + systemd)

## 1. 系统总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                          浏览器 (前端 SPA)                            │
│                  Vue 3 + Vite + Element Plus (frontend/)             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  nginx (443 ssl, server_name 192.168.1.73)          │
│              location /api/  ->  factory_mes_backend (upstream)     │
│              location /     ->  factory_mes_backend (SPA fallback)  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ http://127.0.0.1:3890
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                factory-mes.service (systemd, user scope)            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  server.js  (装配层 65 行)                                     │  │
│  │    ↓ createApp()  →  app.use(auth)  →  routes.register()      │  │
│  │    ↓ services[*].register(app, db)                            │  │
│  └───────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐ │
│  │  routes/  (适配层)│  │  services/ (业务) │  │  middleware/ (横切)│ │
│  │  - instance.js   │  │  - process/*     │  │  - auth.js (JWT)   │ │
│  │  - auth.js       │  │  - equipment/*   │  │                    │ │
│  │  - guards.js     │  │  - cost/*        │  │                    │ │
│  │  - settings.js   │  │  - reportService │  │                    │ │
│  │  - health/root   │  │  - 12+ 单文件    │  │                    │ │
│  └────────┬─────────┘  └─────────┬────────┘  └─────────┬──────────┘ │
│           │                      │                      │            │
│           └──────────┬───────────┴──────────────────────┘            │
│                      ▼                                                │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  db/index.js (better-sqlite3 单例)                              │  │
│  │    - connection.js (DB_PATH 解析, data/mes.db 默认)             │  │
│  │    - pragmas.js (WAL, foreign_keys, busy_timeout)              │  │
│  │    - migrations/ (17 个 SQL, 001~017)                          │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                               ▼
                  ┌────────────────────────────┐
                  │   data/mes.db (SQLite WAL)  │
                  │   data/factory.db (配置)    │
                  │   data/mes.log (stdout/err) │
                  └────────────────────────────┘
```

## 2. 进程内组件

### 2.1 启动顺序 (`server.js`)

```
require('dotenv').config()           # 读 .env
  ↓
require('./app').createApp()         # 1. 装配 express (中间件链)
  ↓
require('./db')                      # 2. 建 SQLite 连接 + PRAGMA
  ↓
app.use('/api', authMiddleware)      # 3. JWT 鉴权 (白名单: /health, /auth/login)
  ↓
root / auth / health / settings      # 4. 基础路由
  ↓
routes/instance.register(app, db)    # 5. 实例重型路由 (16 条)
  ↓
services[*].register(app, db)        # 6. 业务模块 (20+ 个)
  ↓
app.listen(3890, '127.0.0.1')        # 7. 只绑 loopback, 经 nginx 暴露
```

### 2.2 Express 中间件链 (`app/middleware/`)

按调用顺序（`app/index.js` createApp）：

| 顺序 | 中间件 | 文件 | 职责 |
|---|---|---|---|
| 1 | `staticFiles` | `staticFiles.js` | 挂 `frontend/dist/` 静态资源 |
| 2 | `security` | `security.js` | Helmet (CSP / HSTS / X-Frame) |
| 3 | `cors` | `cors.js` | 跨域白名单 |
| 4 | `parser` | `parser.js` | `express.json()` + `urlencoded` |
| 5 | `logger` | `logger.js` | 请求日志 (method, path, status, ms) |

`/api/*` 入口再加 `authMiddleware`（JWT 验证 + rate limit），见 §3。

### 2.3 数据库层 (`db/`)

- **连接**: `db/connection.js` 读 `DB_PATH` 环境变量, 缺省 `data/mes.db`
- **PRAGMA**: `db/pragmas.js` 应用
  - `journal_mode = WAL` (并发读写)
  - `foreign_keys = ON` (引用完整性)
  - `busy_timeout = 5000`
  - `synchronous = NORMAL`
- **迁移**: `db/migrations/001~017_*.sql`, 启动时按序号顺序执行
- **单例**: `db/index.js` 导出的是 `Database` 实例本身 (`better-sqlite3` 同步 API, 无连接池)
- **第二个 DB**: `data/factory.db` — 工厂级配置 (跟 `mes.db` 业务库分开)

## 3. 鉴权 (JWT)

`middleware/auth.js` 自实现 HMAC-SHA256 签名 token:

```
makeToken(uid, role) = base64url({uid, role, exp}) + '.' + hmacSig
verifyToken(token)   = 验签 + 校验 exp
```

- **登录**: `POST /api/auth/login` → `{token, user}`
- **后续请求**: `Authorization: Bearer <token>`
- **白名单**: `/api/health`, `/api/auth/login` 不需 token
- **限流**: `express-rate-limit` (默认 60s 内 10 次登录)
- **角色**: `users.role_code` 关联 `roles.permissions` JSON
  - 权限粒度: `project:read` / `project:*` / `*` (admin)
  - 守卫: `requirePermission(permCode)` / `onlyForemanOrAdmin` / `onlyWelder`

## 4. 数据流

### 4.1 写操作 (典型 — 新增工单)

```
Browser
  │ POST /api/work_orders  (Bearer token, JSON body)
  ▼
nginx 443 ── proxy_pass ──> 127.0.0.1:3890
  │
  ▼
factory-mes 进程
  │ authMiddleware 验 JWT → req.user = {uid, role}
  ▼
routes/instance.js (or workOrderService.register)
  │ routes/guards.js 校验 role (foreman/admin)
  ▼
services/workOrderService.register(app, db)
  │ insert work_orders + instance_bom
  ▼
db/index.js (better-sqlite3, 同步事务)
  │ BEGIN; INSERT...; COMMIT;
  ▼
data/mes.db (SQLite WAL)
  │
  ▼ (下一次 GET 自动可见)
GET /api/work_orders?instance_id=X
  → JSON 响应回前端
```

### 4.2 排程 (重型读 + 批量写)

```
POST /api/equipment_instances/:id/schedule?dryRun=1
  │
  ▼
services/equipment/scheduler/scheduler.js
  │ 1. 查 instance + 全部 process_nodes + 全部 process_dependencies
  │ 2. topo.js: Kahn 拓扑排序 + 环检测
  │ 3. 沿拓扑序计算 earliest (前驱约束 + 工位冲突)
  │ 4. dryRun=1 → 不写, 返回 sample + full
  │ 5. dryRun=0 → 事务内 UPDATE planned_start/_end (N 行)
  ▼
data/mes.db
  │ 同时触发 Gantt 渲染: GET /api/equipment_instances/:id/gantt
```

### 4.3 成本归集 (跨多表)

```
GET /api/equipment_instances/:id/cost_rollup
  │
  ▼
services/cost/rollup/rollup.js
  │ 1. 查 key_components.unit_price + contract_signed (3 档 status)
  │ 2. 查 instance_bom + materials.unit_price → material actual = estimated
  │ 3. 查 work_orders → labor estimated_hours vs actual_hours
  │ 4. 查 equipment_instances.contract_amount (wan) → contract_yuan
  ▼
aggregate.js 纯函数
  │ - aggregateKeyComponents: estimated/actual/signed/pending/over_budget
  │ - aggregateMaterials: estimated=actual (合同未签前)
  │ - deriveContractMetrics: margin = contract_yuan - total_actual
  ▼
JSON 响应: {key, materials, labor, totals, project_status, contract_* }
```

## 5. service 模块清单

### 5.1 `routes/` (适配层 — 7 文件)

| 文件 | 端点数 | 职责 |
|---|---|---|
| `auth.js` | 2 | 登录 / 登出 |
| `health.js` | 1 | `/api/health` |
| `root.js` | 1 | SPA fallback + favicon |
| `instance.js` | 16 | 实例重型路由 (subsystems, cost_rollup, schedule, eco) |
| `settings.js` | 4 | 系统设置 (经 systemSettings 注入) |
| `guards.js` | — | 角色守卫 (onlyForemanOrAdmin / onlyWelder) |
| `_helpers.js` | — | wrap / 错误处理 |

### 5.2 `services/` (业务层 — 20+ 模块)

| 分类 | 模块 | 端点 (估) |
|---|---|---|
| **工艺 (process/)** | `node.js` (6 文件) | 16+ |
| | `params.js` | 4 |
| | `progress.js` | — |
| | `nodeSubsystem.js` / `subsystemClassifier.js` | — |
| **设备 (equipment/)** | `service.js` | — |
| | `scheduler/` (4 文件) | 2 |
| | `gantt.js` / `gantt/` | 2 |
| | `oee.js` / `multiInstanceScheduler.js` | 4 |
| **成本 (cost/)** | `keyComponentPrices/` (4 文件) | 6 |
| | `materialPrices/` (4 文件) | 4 |
| | `rollup/` (2 文件) | 1 |
| **工艺树 (processTree/)** | `subsystems/` (4 文件 + 桥接) | 1 |
| | `crossSubsystemDeps/` (3 文件 + 桥接) | 1 |
| | `mindmap/` (1 文件) / `mindmap.js` | 1 |
| | `generator.js` / `idCodec.js` / `breadcrumb.js` | — |
| **工单/物料** | `workOrderService.js` | — |
| | `materialService.js` | — |
| | `materialMovement.js` | — |
| | `materialPlanner.js` | — |
| **质量** | `qcService.js` / `qcInspection.js` | — |
| **报表** | `reportService/` (7 文件) | 14 |
| **设置** | `systemSettings.js` / `userManagement.js` | — |
| **其他** | `eco.js` / `feishuNotify.js` / `scanner.js` | — |
| | `delayAlerts.js` / `dashboardAlerts.js` | — |

> **拆分原则**: `services/xxx/` 子目录 = `index.js` 装配 + `_helpers.js` 工厂函数 + 业务子模块按职责命名。`register(app, db)` 是统一入口。

## 6. 外部接口

| 接口 | 协议 | 端点 / 文件 |
|---|---|---|
| 浏览器 | HTTPS (443) | nginx → factory-mes |
| 飞书通知 | HTTPS POST | `feishuNotify.js` → `data/feishu_queue.log` (本地队列) |
| GitHub | SSH | `git@github.com:duduanbin1982-max/MES.git` (推送 / CI 镜像) |
| systemd | 本地 socket | `factory-mes.service` |
| systemd 日志 | journald | `data/mes.log` (追加) |

## 7. 关键设计决策

1. **better-sqlite3 同步 API**: 单进程内串行, 无连接池, 事务简单 (`db.transaction(...)`)。并发靠 `WAL + busy_timeout`。
2. **自实现 JWT (HMAC-SHA256)**: 不引 `jsonwebtoken` 库, 减少依赖。`JWT_SECRET` 必填且 ≥32 字符, 否则进程拒启。
3. **service 模块化**: 每个 service `register(app, db)`, 业务逻辑跟 express 路由解耦, 易测试 (`tests/* 走直接 require(svcPath).register(app, db)`)。
4. **拆子目录自动 fallback**: `require('./services/xxx')` 优先 `xxx.js`, 找不到就 `xxx/index.js`。拆完必须删原 `.js`。
5. **process_dependencies 三类**: `FS` (Finish-Start, 默认) / `SS` (Start-Start) / `FF` (Finish-Finish), 排程器全支持。
6. **成本口径**: 合同未签前 `material.actual = estimated`; 关键件按 `unit_price` + `cost_status` 4 档 (within_5pct / over_5pct / over_10pct / pending)。

## 8. 相关文档

- `docs/deploy.md` — 部署手册 (从 0 到跑起来)
- `docs/git-workflow.md` — 3 钩子 + 3 道闸门
- `docs/splitting-guide.md` — 4 轮拆分套路
- `docs/glossary.md` — 业务术语