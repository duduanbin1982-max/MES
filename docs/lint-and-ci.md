# ESLint 与 CI（2026-10-17 落地）

对应主报告 **R14 / R15**、实施方案 **W3-5**。

## 一、本地怎么用

```bash
# 后端（仓库根目录）
npm run lint          # 全量检查（error 阻断，warning 只提示）
npm run lint:fix      # 自动修复可修项
npm run lint:strict   # warning 也当错误（后端已达标：0/0）
npx prettier --write <文件>   # 单文件格式化（批量重排存量代码不在本阶段范围）

# 前端（frontend/）
npm run lint --prefix frontend          # eslint-plugin-vue + typescript-eslint
npm run lint:fix --prefix frontend
npm run lint:strict --prefix frontend   # 棘轮达标后用这个
```

覆盖率：
- 后端：`app/ services/ routes/ middleware/ db/ config/ tests/ scripts/` 下全部 `.js`（515 个文件）→ **0 error / 0 warning**
- 前端：`frontend/src` + `frontend/tests`（133 个 `.vue` + 55 个 `.ts`）→ `eslint-plugin-vue@10` + `typescript-eslint@8`，
  **0 error / 0 warning**；类型正确性仍由 `vue-tsc` 负责，模板编译由闸门里的 `vite build` 检查

## 二、规则清单（eslint.config.js）

| 级别 | 规则 | 为什么 |
|---|---|---|
| error | `no-console` | 统一日志出口（与 `tests/logging.test.js` 的 LOG.8 守卫同源）；`tests/`、`scripts/`、根目录运维脚本豁免 |
| error | `no-var` | 自动修复 |
| error | `prefer-const` | 自动修复 |
| error | `no-restricted-syntax` | 禁止业务函数内 `require('../db')` —— 《架构规则》第 5 条 |
| error | `no-undef` | **本次落地直接抓出 6 处真实缺陷**（见下） |
| error | `no-unused-vars` | 2026-10-17 棘轮已完成：151 处存量清零（分 services/tests/其余 三批） |
| error | `eqeqeq`（smart） | 同上，存量清零 |

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

## 五、棘轮状态（2026-10-17 已完成）

| 步骤 | 状态 |
|---|---|
| 1. error 级规则 0 违规，存量降 warn 登记 | ✅ 2026-10-17（`acfdc7d`） |
| 2. 按目录分批清理 `no-unused-vars` | ✅ 2026-10-17（`ef4f960` services / `24f6190` tests / `6dd430b` 其余） |
| 3. `no-unused-vars`、`eqeqeq` 升回 error + 闸门 `--max-warnings 0` | ✅ 见本次提交 |
| 4. 前端接入 `eslint-plugin-vue` + `typescript-eslint` | ✅ 2026-10-17 |
| 5. 前端 warning 棘轮清零（237 → 0）并全部升 error | ✅ 2026-10-17 |

### 前端棘轮完成记录（237 → 0，全部规则 error 级）

| 规则 | 原数量 | 处置 |
|---|---|---|
| `vue/no-mutating-props` | 151 | 分 4 批（`cfc152f` quality 31 / `e089b30` components+bom+documents 54 / `046131d` purchase 51 / `282a4cc` resources 13）全部改为 **defineModel** + 父组件 `v-model:xxx`；补充 `BomDialogs.vue` 包装组件级联修复 |
| `@typescript-eslint/no-unused-vars` | 63 | 自动清理未使用导入/解构项 |
| `no-console` | 21 | 移除前端调试输出（错误提示统一走 `ElMessage`） |
| `vue/no-unused-vars` | 2 | 去掉模板里未使用的 slot/v-for 变量 |

**踩到的两个坑（重要）**
1. **包装组件级联**：`BomDialogs.vue` 把 `addForm` 这个 **prop** 用 `v-model:add-form` 透传给子组件，
   而 `v-model` 不能绑在 prop 上 → `vite build` 直接失败（`v-model cannot be used on a prop`）。
   解法：包装组件也必须 `defineModel`，并让它自己的父级改用 `v-model:xxx`。
2. **`vue-tsc` 查不出模板编译错误**：上面这个错误 `vue-tsc --noEmit` 是**通过**的，只有 `vite build` 才报。
   因此闸门新增**前端模板编译检查**（`vite build --outDir /tmp`，不动 dist），CI 本来就有 build 步骤。

前端 lint 的设计取向（写在 `frontend/eslint.config.js` 注释里）：只用 plugin-vue 的 **flat/essential**（正确性），
**不开** flat/recommended 的缩进/换行类格式规则，避免一次性制造上千条格式告警；TS 侧用非 type-checked 的
recommended（速度优先，类型由 `vue-tsc` 保证）。`vue/multi-word-component-names` 关闭（视图多为单词名），
`@typescript-eslint/no-explicit-any` 关闭（历史代码大量 any）。

**当前基线：`npx eslint .` → 0 error / 0 warning（515 文件）。**

清理时踩到的坑（写下来防复发）：
- `let x = null` 但**只写不读**（"assigned a value but never used"）时，删声明必须**连同所有写入点**
  一起删；否则会留下裸赋值被 `no-undef` 抓住（`iotCollector/index.js` 的 `dbRef` 就是这样）。
- 删除 `const x = fn()` 时若 `fn()` 有副作用，应保留调用、只去掉绑定。
- 删除 require 解构里的全部名字时，保留裸 `require("...")` 以保留模块副作用。

## 六、常见问题

- **改了文件但 lint 说某变量未使用**：优先删代码，不要加 `// eslint-disable`；
  确实需要豁免时用完整注释说明原因，且只 `// eslint-disable-next-line` 单行。
- **`no-undef` 报某个函数没定义**：几乎总是拆分/搬迁时漏了 require 或 ctx 解构，按真实缺陷处理。
- **`npm ci` 后 lint 报配置错误**：确认 `node_modules/.bin/eslint` 存在；devDependencies 含
  `eslint@^10`、`@eslint/js`、`globals`、`prettier@^3`。
