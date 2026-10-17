# ESLint 与 CI（2026-10-17 落地）

对应主报告 **R14 / R15**、实施方案 **W3-5**。

## 一、本地怎么用

```bash
npm run lint          # 全量检查（error 阻断，warning 只提示）
npm run lint:fix      # 自动修复可修项（no-var / prefer-const）
npm run lint:strict   # warning 也当错误（棘轮达标后用这个）
npx prettier --write <文件>   # 单文件格式化（批量重排存量代码不在本阶段范围）
```

覆盖率：`app/ services/ routes/ middleware/ db/ config/ tests/ scripts/` 下全部 `.js`（515 个文件）；
`frontend/` 由 `vue-tsc` + `npm run test:domain` 把关，不纳入 ESLint（尚未接 eslint-plugin-vue）。

## 二、规则清单（eslint.config.js）

| 级别 | 规则 | 为什么 |
|---|---|---|
| error | `no-console` | 统一日志出口（与 `tests/logging.test.js` 的 LOG.8 守卫同源）；`tests/`、`scripts/`、根目录运维脚本豁免 |
| error | `no-var` | 自动修复 |
| error | `prefer-const` | 自动修复 |
| error | `no-restricted-syntax` | 禁止业务函数内 `require('../db')` —— 《架构规则》第 5 条 |
| error | `no-undef` | **本次落地直接抓出 6 处真实缺陷**（见下） |
| warn | `no-unused-vars` | 存量约 150 处未使用变量/导入；先 warn，1–2 个迭代清零后改 error |
| warn | `eqeqeq`（smart） | 存量 26 处松散相等，避免一次性大改 |

忽略：`node_modules/`、`frontend/`、`attic/`、`archive/`、`.codex-backups/`、`data/`、`logs/`、`backups/`、`.tmp/`。

## 三、落地当天修掉的真实缺陷（no-undef 抓到的）

| 文件 | 问题 | 影响 |
|---|---|---|
| `services/materialPlanner/routes_2.js` | 拆分时漏注入 `get` | `/api/material-planner/mrp` 等 5 处调用会 500 |
| `services/scanner.js` | 缺 `feishuNotify` / `autoUnlockSuccessors` 引入；且 helper 少传 `db` 实参 | 扫码完成/卡住分支必崩 |
| `services/delivery/routes.js` | 调用了全库不存在的 `defaultEscalationRules()`，`safeAll` 未从 ctx 取 | `/api/exceptions/escalation-rules/list` 一直 500 |
| `services/purchase/suppliers/context.js` | AST 拆分后 `inferCategory` 丢失（定义留在 index.js） | 供应商分类回填走不到 |
| `scripts/dev/astsplit.js` | `switch` 里 `case "MemberExpression"` 重复 | 工具自身逻辑瑕疵（不影响产物） |
| `app/errors.js` | 失效的 `eslint-disable` 注释 | 噪音 |

> 这类"只有运行时才炸、测试没覆盖到"的缺陷，正是静态检查的价值。后续新增服务如果出现
> `no-undef`，一律视为真实缺陷，不允许加 ignore 绕过。

## 四、闸门与 CI

- **本地**：`.githooks/pre-commit`、`pre-push` → `scripts/pre-deploy-test.sh`
  该脚本在语法体检之后新增 **ESLint 步骤**（error 阻断），日志在 `logs/predeploy/eslint-*.log`
- **服务启动**：systemd `ExecStartPre` 走同一个闸门 → lint 不过则拒绝启动
- **CI**：`.github/workflows/test.yml`（GitHub Actions）
  步骤：安装依赖 → **ESLint** → 四类守卫（schema 指纹 / 分层 / 路由唯一 / 模块清单）
  → 前端类型检查 → 前端 domain 单测 → 前端构建 → 完整部署闸门 → 失败上传日志

## 五、棘轮计划（把 warn 收成 error）

1. **第 1 步（已完成）**：error 级规则 0 违规；存量问题降为 warn 并在本文件登记。
2. **第 2 步**：按目录分批清理 `no-unused-vars`（建议顺序：`services/` → `routes/` → `tests/`），
   每批用 `npx eslint <目录> --fix` + 人工复核 diff。
3. **第 3 步**：清零后把 `no-unused-vars`、`eqeqeq` 改回 `error`，并把 `npm run lint:strict` 接入闸门。
4. 可选：接入 `eslint-plugin-vue` + `typescript-eslint` 覆盖 `frontend/`，替换当前"只靠 vue-tsc"的做法。

## 六、常见问题

- **改了文件但 lint 说某变量未使用**：优先删代码，不要加 `// eslint-disable`；
  确实需要豁免时用完整注释说明原因，且只 `// eslint-disable-next-line` 单行。
- **`no-undef` 报某个函数没定义**：几乎总是拆分/搬迁时漏了 require 或 ctx 解构，按真实缺陷处理。
- **`npm ci` 后 lint 报配置错误**：确认 `node_modules/.bin/eslint` 存在；devDependencies 含
  `eslint@^10`、`@eslint/js`、`globals`、`prettier@^3`。
