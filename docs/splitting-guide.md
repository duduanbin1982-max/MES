# 代码拆分指南 (Splitting Guide)

## 目标

把单个大文件拆成职责清晰的多文件, 在不破坏外部行为的前提下:

- 让 200+ 行文件变成 < 100 行的多个文件
- 路径约定保持稳定, 现有 `require` 零修改 (Node 默认解析 `db/` → `db/index.js`)
- 每次拆分都有测试闸门保护 (167 个测试 + 语法体检)
- 每次拆分都立即 commit + push, 失败可回滚

## 适用阈值

| 文件行数 | 建议 |
|---|---|
| < 100 | 不拆 |
| 100 - 199 | 视情况 (边界模块可拆) |
| **200 - 499** | **应当拆** |
| 500+ | 必须拆, 同时考虑重构 |

## 4 轮拆分套路

### Round 1 — 抽算法 (P0 mindmap)

**场景**: 单文件 400+ 行, 含可独立测试的纯算法 + 业务胶水.

**套路**: 找**无副作用的纯函数** (输入 → 输出, 不查 DB, 不写日志), 整段挪到独立文件.

```
mindmap.js (486 行) -> mindmap.js (436) + idCodec.js (68) + breadcrumb.js (12)
```

- `idCodec.js`: 节点 ID 编/解码 (base36 ↔ 数字), 无依赖
- `breadcrumb.js`: 面包屑路径生成, 5 行函数
- `mindmap.js` 只剩业务胶水: 调 DB → 调算法 → 返回

**判断"能不能抽"的口诀**:
> 函数内**没有 `db.prepare` / `app.get` / `console.log` / 改全局** → 90% 能抽.

**`mindmap.js` 抽完后**:
- 单元测试可以只测 `idCodec` / `breadcrumb` (无 DB fixture)
- 集成测试只覆盖 `mindmap.js` 的胶水部分
- 业务回归定位更容易 (出问题先看 436 行, 不行再看 68 行)

### Round 2 — 子模块按职责拆 (process/node 案例)

**场景**: 1 个 service 文件, 6+ 端点, 端点之间业务重叠 (共用 helpers + 互相调).

**套路**: 端点 → 子模块, 共用代码 → `_helpers.js`, 顶层 → `index.js`.

```
process/node.js (219 行, 16 端点)
  -> process/node/
       _helpers.js   (38 行, wrap/all/get/run/autoUnlockSuccessors)
       index.js      (19 行, register 装配)
       nodeCrud.js   (95 行, 5 端点: process_tree / POST / PUT / DELETE / GET)
       nodeActions.js(97 行, 5 端点: execute/auto_unlock/move/assign/efficiency)
       nodeParams.js (25 行, 2 端点: GET/POST params)
       dependencies.js (30 行, 2 端点: POST/DELETE process_dependencies)
     process/node.js (7 行垫片)
       module.exports = require('./node/index')
```

**关键决策**:
- **保留原文件为 1 行 re-export** (7 字节), 所有 `require('./services/process/node')` 零修改
- **子模块名按业务分组** (CRUD / Actions / Params / Dependencies), 不按"按字母拆" / "按行数均分"
- **`_helpers.js` 用下划线前缀**, 表明"非业务, 不应被外部 require"
- **API 风格二选一**:
  - `register(app, db)` 模式 (适合一组相关端点, 配 `_helpers` 工厂)
  - `(req, res, db)` 导出 (适合纯算法 / 重型逻辑)

**踩坑 1: 函数签名变化**

原 `process/node.js` 闭包内:
```js
function register(app) {
  const all = (sql) => db.prepare(sql).all();  // 闭包拿 db
  app.get('/api/foo', (req, res) => {
    const rows = all('SELECT...');   // 不传 db
  });
}
```

拆完后所有 `all(...)` 必须改成 `all(db, ...)` (helpers 现在是工厂函数, 不再闭包).

**修法**: 用 perl 一行命令批量替换, 关键是**排除 `app.get` / `app.post` 等路由注册行**:
```bash
perl -i -pe "s/(?<![\w.])(\b(?:all|get|run|autoUnlockSuccessors)\()/$1 db, /g" file.js
```
- `(?<![\w.])` 负向后看: 前面不是 `.` (排除 `app.get`)
- `\b` 单词边界

**踩坑 2: 语法 OK, 运行时炸**

`node --check` 通过 ≠ 实际能跑. 必须跑完整 `run-all-tests.sh` + deploy 端到端冒烟.

### Round 3 — server.js 装配层 (server 案例)

**场景**: 单文件 200+ 行, 混着: 依赖加载 / express 实例 / 中间件 / auth 逻辑 / 内联路由 / SPA fallback / listen.

**套路**: 按"职责块"拆, 每块一个 `routes/*.js`, server.js 只剩装配.

```
server.js (236 行)
  -> server.js (58 行装配层)
  -> routes/_helpers.js   (16, 共享 wrap/all/get/run 工厂)
  -> routes/auth.js       (54, login/me/logout)
  -> routes/guards.js     (19, onlyForemanOrAdmin/onlyWelder)
  -> routes/health.js     (15, /api/health)
  -> routes/root.js       (33, / / favicon SPA fallback)
  -> routes/instance.js   (73, 16 条实例重型路由)
  -> routes/settings.js   (27, 7 条 settings 路由)
```

**装配层 (server.js 58 行) 结构**:
```js
// 1. dotenv + 依赖
require('dotenv').config();
const { createApp } = require('./app');
const db = require('./db');
const { authMiddleware } = require('./middleware/auth');
const { onlyForemanOrAdmin, onlyWelder } = require('./routes/guards');

// 2. express 实例
const app = createApp();
const PORT = 3890;

// 3. 装配 (按"无 auth -> auth 白名单 -> services" 顺序)
require('./routes/root').register(app);          // 无 auth
app.use('/api', authMiddleware);
require('./routes/auth').register(app, db);      // 白名单
require('./routes/health').register(app, db);
require('./routes/settings').register(app);
require('./routes/instance').register(app, db);
// 19 个 services/*.register(app, db) ...

// 4. 404 + listen
app.use((req, res) => res.status(404).json({ error: 'not found' }));
app.listen(PORT, '127.0.0.1', () => { ... });
```

**关键决策**:
- **拆 routes/ 而不是 services/** (services 已经是业务层, 再拆会过度)
- **role 守卫 (onlyForemanOrAdmin 等) 单拎到 routes/guards.js** (workOrderService 仍要注入用, 但文件小, 不进 services)
- **重型路由 (16 条) 全部在 routes/instance.js** (req/res 适配, 业务逻辑仍在 services/)
- **`authMiddleware` 仍在 `app.use('/api', authMiddleware)` 注入**, 白名单在 middleware/auth.js 内部按 `req.path` 后缀匹配

**踩坑 1: 字段名猜错**

```js
// 原 server.js 旧版用的:
run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);

// 实际 schema 是:
last_login   (没有 _at)
```

`schema/db.js` 没导出字段, 只能从原代码反推. 改前查 `db.prepare("PRAGMA table_info(users)").all()`.

**踩坑 2: 旧函数签名 vs 新 middleware/auth.js 签名**

```js
// 我猜的:
makeToken({ uid: user.id, role: user.role_code });  // 对象
// 实际的:
makeToken(user.id, user.role_code);                  // 两参
```

旧 server.js 里的 `makeToken(user.id, user.role_code)` 是对的, 我没看就改了 → login 500.

**修法**: 拆前**完整读**原 server.js, 不要靠脑补. 用 `cat -n server.js > /tmp/orig` 留底, 拆完一行行对.

### Round 4 — 顶层单例拆 (app.js + db.js 案例)

**场景**: 顶层模块文件 < 50 行, 但**被多处 require**, 改路径会牵动很多调用点.

**套路**: 拆成目录, 顶层 `index.js` 暴露原 API, 旧文件路径**保留为垫片或弃用**.

```
app.js (43 行) -> app/
                    index.js        (35, createApp + 装配)
                    middleware/    (5 文件: staticFiles, security, cors, parser, logger)
                    config/
                      paths.js     (DIST/DIST_EXISTS)

db.js  (17 行) -> db/              (与 db/migrations/ 平级)
                    index.js       (14, db 单例 export)
                    connection.js  (22, DB_PATH + mkdir + Database)
                    pragmas.js     (14, WAL/foreign_keys/synchronous)
                  + db.js (3 行垫片, 后来删)
```

**关键决策**:
- **新文件叫 `index.js`, 不是 `app.js`** — Node 默认 `require('./app')` 解析到 `./app/index.js`, 所有调用点零修改
- **`db.js` 同理** — `require('./db')` 解析到 `./db/index.js`
- **`db.js` 垫片只**在 `tests/utils-partno.test.js` 用 `require.resolve('../db.js')` 改 require.cache 时才需要. 修测试后删掉.

**踩坑 1: `require.resolve('../db.js')` 与 `require.resolve('../db')` 路径不同**

```bash
require.resolve('./db')         = /path/to/db.js       (旧)  or  /path/to/db/index.js (新)
require.resolve('./db.js')      = /path/to/db.js
require.resolve('./db/index.js')= /path/to/db/index.js
```

Node 默认会先找文件再找目录. `require('./db')` 优先匹配 `db.js`, 然后才 fallback 到 `db/index.js`. **加了 `db.js` 垫片**后, `require('./db')` 会解析到垫片, 不是 `db/index.js`!

**业务代码无影响** (垫片只是 `module.exports = require('./db/index')`), 但**测试 hack 用 `require.resolve('../db.js')` 时**改的是垫片 cache, 而 `partNo.js` 实际加载的是 `db/index.js` cache → **不命中**.

**正确写法**: `require.resolve('../db')` (不带 .js) → 解析到 `db/index.js` → 与 partNo.js 实际加载路径一致 → cache 命中.

**踩坑 2: `module.exports = obj; module.exports.foo = bar;` 不生效**

```js
const db = new Database(...);  // db 是 better-sqlite3 实例
module.exports = db;            // 现在 require('./db') = db 实例
module.exports.DB_PATH = ...;   // ❌ 不报错, 但 db 实例上没这属性 (frozen-like)
```

要 export 自定义字段, 必须用对象 wrapper:
```js
module.exports = { ...db, DB_PATH, DB_DIR };  // ❌ better-sqlite3 实例 spread 会炸
module.exports = db; module.exports.DB_PATH = ...;  // ❌ 同上
```

**实际解决**: 不 export 自定义字段. 谁需要 `DB_PATH` 自己读 `process.env.DB_PATH` 或 require connection.js.

## 通用 checklist

每次拆分前:

- [ ] 备份原文件: `cp src.js src.js.bak`
- [ ] 列所有调用点: `grep -rn "require.*src['\"]" --include="*.js" --exclude-dir=node_modules`
- [ ] 决定子目录命名 (按业务, 不按字母/行数)
- [ ] 决定每个子文件职责 (端点组 / 算法 / 配置 / 类型)
- [ ] 写 `_helpers.js` 还是工厂模式 (看有没有共用闭包)
- [ ] 原文件是否需要保留为 1 行 re-export 垫片

每次拆分中:

- [ ] 逐文件 `node --check` 通过
- [ ] `require.cache` 行为变化要测试覆盖
- [ ] 字段名 / 函数签名**从原文件 grep** 出来, 不脑补

每次拆分后:

- [ ] 跑 `bash scripts/deploy.sh` (测试闸门 + 重启 + 健康)
- [ ] 至少 5 个端点冒烟, 包括跨 auth 边界
- [ ] 看 `journalctl --user -u factory-mes.service -n 20` 找 500 / TypeError
- [ ] commit + push 走 SSH (无 token)
- [ ] 立即触发 `pre-commit` 钩子验证 (改一行无害代码 → commit → 看到 ✅)

## 命名约定

| 场景 | 命名 | 例子 |
|---|---|---|
| 子模块 | 业务名 (单数) | `nodeCrud.js` / `instance.js` |
| 共用 helpers | `_helpers.js` (下划线前缀) | `routes/_helpers.js` |
| 类型/常量 | `constants.js` / `types.js` | `crossSubsystemDeps/constants.js` |
| 算法 | 算法名 (动名词) | `idCodec.js` / `loadSubsystems.js` |
| 注册入口 | `index.js` | `services/process/node/index.js` |
| 路由分组 | 资源名 (单数) | `routes/auth.js` / `routes/settings.js` |
| 顶层装配 | `<thing>/index.js` | `app/index.js` / `db/index.js` |

**禁用**:
- ❌ `util.js` / `utils.js` / `common.js` (含义不清)
- ❌ `misc.js` / `helpers.js` (无下划线会与业务混淆)
- ❌ `fooPart1.js` / `fooPart2.js` (按行数均分)

## 回滚

每个 commit 都有清晰 message 和 stat. 拆出错就:

```bash
git revert HEAD              # 新增 revert commit, 保留历史
git reset --hard HEAD~1      # 删掉 commit, 强推 (需 --force-with-lease)
```

## 参考

- git 流程: `docs/git-workflow.md`
- 部署脚本: `scripts/deploy.sh`
- 测试闸门: `scripts/pre-deploy-test.sh`
- 4 轮拆分 commit:
  - `2dbda34` refactor(app): 拆 express 中间件 + db 连接
  - `0aead0d` test(utils-partno): 删 db.js 垫片
  - `c90fce6` perf(hooks): pre-commit 早退
  - `42e4219` chore(init): 现状快照