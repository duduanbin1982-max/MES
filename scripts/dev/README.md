# scripts/dev/

开发期一次性工具。**不参与运行时**，不会被 `server.js` 或任何 service `require`，
也不进部署闸门的测试范围。

## 为什么会有这三个

拆分"200+ 行的大文件"时，正则方案在下面这些场景会失步，进而把 SQL 列名、URL 片段
当成自由变量（`purchase/suppliers.js` 就是这么卡了两轮）：

- 路由里的多行 SQL、嵌套模板串 `` `${x ? `a` : 'b'}` ``
- 单引号转义惯用法 `sql.replace(/'/g, "''")`（`'` 会被误当字符串开头）
- 嵌套函数里的解构、`for (const [a, b] of ...)`、无括号箭头参数

换成 AST 之后，span 直接取节点的 `start/end`，自由变量用真正的作用域分析
（声明集 vs 引用集），不再依赖"保留字白名单" —— 上一轮正是因为把 `get` 写进保留字，
让 `material/inventory` 的 `get` 取数助手没被注入，接口 500 而闸门是绿的。

解析器用 `@babel/parser`：仓库里没有独立 `acorn`（Vite 7 换 rolldown 了），
但 frontend 的依赖树里有它。脚本会先试 `require("@babel/parser")`，
失败再走 `frontend/node_modules/@babel/parser`。

## 用法

全部默认 **dry-run**，只打印分析结果；加 `--apply` 才落盘。

```bash
# 1) register(app, db) 闭包 -> context.js + routes_N.js + index.js
node scripts/dev/astsplit.js services/foo/bar.js            # 先看分组
node scripts/dev/astsplit.js services/foo/bar.js --apply

# 2) 顶层声明搬移：纯声明进 _helpers.js，let/var 可变状态原地不动
node scripts/dev/astdecls.js services/iotCollector.js --apply

# 3) 工厂内部小函数提升（只依赖 ctx/helpers/参数的那些）
node scripts/dev/astinner.js services/foo/bar.js createXxxReadModel --apply
```

## 三者的判定规则

| 工具 | 搬什么 | 怎么判断安全 |
|---|---|---|
| `astsplit.js` | `app.<method>(...)` 语句 → 按 URL 段分组（单组 ≤150 行） | 每条路由的自由变量必须能归类到：prelude 绑定（→ ctx 解构）、文件顶层声明（→ 作为 `deps` 传进 `createContext`）、`require` 绑定（→ 复制 require）。有归不了类的就**整体放弃**，不猜 |
| `astdecls.js` | 顶层 `function` / `const` | `let`/`var` 视为可变模块状态，一律不搬；`require` 绑定不搬（避免重复声明）但会复制到新模块；某声明若引用了"留在原地的名字"，它也不搬（迭代收敛） |
| `astinner.js` | 工厂体内的函数声明 | 自由名 ⊆ `ctx`/`helpers` 解构出的名字 ∪ require ∪ 全局 ∪ 自身参数；引用了外层局部（如 `id`）时把它提升为**入参并在调用点补实参**；"容器"函数（自身包含其它候选）不搬 |

## 安全网

三个工具都会在落盘后自动核对，任一不符就 `git checkout` 回滚 + 删掉新目录：

1. **导出面逐字一致**：`Object.keys(require(目标))` 前后对比
2. **语法**：对每个新文件跑 `node --check`
3. **可加载**：require 一次不抛错

但请注意：**这些核对抓不到行为偏差**。`material/inventory` / `schedule/routes`
第一轮就是这么"核对通过、闸门红"的（见下）。所以 apply 之后**必须**再跑：

```bash
bash scripts/pre-deploy-test.sh          # 508 用例 + 前端 domain 13 用例
```

## 已知限制

- `astinner.js` 的嵌套函数参数化还差最后一步：签名上加了 `id`，调用点的实参补丁
  在某次实测里没落上（`statusDone("work_orders", ...)` 缺 `id`），
  `projectWorkflow.js` 因此没有拆成。再动之前请先跑 dry-run 确认
  `(+id)` 这类标注与 `index.js` 里的调用点一致。
  （`freeNames` 对 `[id]` 这类数组实参曾有漏检，现在用文本兜底 + 宁可多传参数。）
- `astsplit.js` 的路由分组是启发式的（URL 段 + 150 行上限），只影响文件划分，
  不影响行为。
- 三个工具都会**删除原文件**（改成同名目录），apply 前请确认工作区干净，
  出问题好回滚。

## 历史

- 2026-10-11 建 AST 版，替换掉正则版（`.tmp/routesplit.py` 那一套）
- 落地的拆分：`views` / `mutations` / `fieldServiceCore`（正则版第 1 批）、
  `materialPlanner` / `masterDataService`（正则版第 2 批）、
  `material/inventory` / `schedule/routes`（正则版第 3 批，修掉 `get` 保留字问题后成功）、
  `purchase/suppliers`（AST 第 4 批）、`iotCollector`（AST 第 5 批）
