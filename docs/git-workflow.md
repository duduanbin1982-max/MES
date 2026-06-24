# Git 工作流

## 仓库布局
- 主分支: `main`
- 钩子: `.githooks/` (项目内, 不是 `.git/hooks/`)
- 钩子指向: `git config core.hooksPath .githooks` (已配置, 进库时保留)

## 三个钩子

| 钩子 | 时机 | 动作 | 耗时 |
|---|---|---|---|
| `pre-commit` | `git commit` 前 | 跑 `pre-deploy-test.sh --quiet` | ~0.7s (167 测试 + 语法体检) |
| `commit-msg` | 写完 commit message 后 | 检查 Conventional Commits 格式 | <0.01s |
| `pre-push` | `git push` 前 | 跑 `deploy.sh --test-only` (完整闸门) | ~1s |

全部用 `--no-verify` 可跳过:
```bash
git commit --no-verify -m "msg"   # 跳过 pre-commit + commit-msg
git push --no-verify              # 跳过 pre-push
```

## commit message 规范 (commit-msg 强制)

格式: `<type>(<scope>): <subject>`

允许的 type:
- `feat` 新功能
- `fix` 修 bug
- `refactor` 重构 (既不修 bug 也不加功能)
- `perf` 性能优化
- `test` 加/改测试
- `docs` 文档
- `chore` 杂项 (依赖, 配置, 工具)
- `style` 代码格式 (不改语义)
- `build` 构建系统
- `ci` CI 配置

scope 例子: `server` `auth` `cost` `process` `tree` `hooks` `deploy` `ci`

例:
```
feat(server): 拆 server.js 装配层
fix(auth): 修 last_login 列名
refactor(process): 拆 process/node 子模块
chore(ci): 加 pre-commit 测试闸门
```

## 部署工作流

```bash
# 1. 改完代码
git add .
git commit -m "feat(xxx): ..."
#    ↑ pre-commit 跑 167 个测试, 失败就阻断

# 2. 本地手动跑完整闸门 (可选, 模拟 deploy)
bash scripts/deploy.sh --test-only

# 3. 推 + 部署
git push     # pre-push 跑 test-only
bash scripts/deploy.sh   # 测试 + 重启 + 健康 200

# 紧急逃生 (不推荐)
bash scripts/deploy.sh --no-test
git commit --no-verify
```

## 闸门原理 (3 道防线)

```
       commit          push            restart
         │              │                │
   ┌─────▼─────┐  ┌─────▼─────┐  ┌──────▼──────┐
   │ pre-commit│  │ pre-push  │  │ ExecStartPre │
   │  0.7s     │  │  1s       │  │  systemd 单元 │
   └─────┬─────┘  └─────┬─────┘  └──────┬──────┘
         │              │                │
         └──────────────┴────────────────┘
                        │
                  scripts/pre-deploy-test.sh
                  (run-all-tests.sh + 语法体检)
```

任意一道挂了, 改动都不会进生产。

## 跳过钩子的合法场景

- **配置类改动** (改 .gitignore, 加新脚本): 用 `--no-verify`
- **文档/注释改动**: 一般不需要跳过, 跑一下 0.7s
- **CI 紧急修复**: `deploy.sh --no-test` 是最后的逃生口

## 已知陷阱

- `pre-deploy-test.sh --quiet` 模式依赖 `bash`, 不要换成 `sh`
- `git add` 不会重读 `.gitignore`, 改规则后需 `rm .git/index && git add -A`
- `git commit --amend` 时钩子看的是 `git diff --cached`, 无 staged 改动就早退
- pre-push 无 remote 时会失败 (这是 git 行为, 不是钩子问题)