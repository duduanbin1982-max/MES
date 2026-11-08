# TBM-MES 代码发布版本管理

> 建立日期：2026-11-08  
> 适用：`/home/dubin/factory-mes` 主仓库  
> 版本规则：SemVer（`MAJOR.MINOR.PATCH`）

## 1. 目标

把“提交级管理”升级为可追溯的“发布级管理”：

- 每个生产版本有唯一 `vX.Y.Z` tag；
- `VERSION`、`package.json`、`CHANGELOG.md` 与 tag 一致；
- 每次发布生成发布台账 `releases/vX.Y.Z.json`；
- 发布前强制跑部署闸门；
- 发布失败可回到上一个 tag。

## 2. 版本号规则

| 变更类型 | 版本位 | 示例 |
|---|---|---|
| 不兼容 API/数据结构 | MAJOR | 3.0.0 |
| 向后兼容新功能 | MINOR | 2.4.0 |
| 修复/小优化 | PATCH | 2.4.1 |

- `VERSION` 是当前**已发布**版本；
- `package.json` / `package-lock.json` 随发布同步；
- 历史 tag 不移动、不覆盖。

## 3. 发布流程

```bash
# 1) 预览：不修改文件，但仍跑测试闸门
bash scripts/release.sh --minor --dry-run

# 2) 正式发布：更新版本文件/CHANGELOG、两次提交、打 tag、推送
bash scripts/release.sh --minor

# 3) 部署
bash scripts/deploy.sh
```

常用参数：

```bash
bash scripts/release.sh --patch
bash scripts/release.sh --major
bash scripts/release.sh --version 2.4.0
bash scripts/release.sh --minor --skip-test      # 已手动跑过闸门
bash scripts/release.sh --minor --no-push        # 只生成本地 commit/tag
```

脚本会检查：

1. 分支必须 `main`（可用 `--allow-branch` 例外）；
2. 工作树必须干净（可用 `--allow-dirty` 例外）；
3. 目标版本必须大于 `VERSION`；
4. 目标 tag 不存在；
5. 默认运行 `scripts/pre-deploy-test.sh`；
6. `CHANGELOG.md` 已有目标小节则保留，否则按 conventional commits 生成；
7. 生成 `releases/vX.Y.Z.json`。

## 4. 发布产物

| 产物 | 说明 |
|---|---|
| `VERSION` | 当前已发布版本 |
| `package.json` / `package-lock.json` | 同步版本号 |
| `CHANGELOG.md` | 面向人的变更说明 |
| `releases/vX.Y.Z.json` | 发布台账：版本、tag、源提交、发布提交、闸门结果、schema 指纹、提交数 |
| Git annotated tag `vX.Y.Z` | 不可变发布标识 |

发布台账示例字段：

```json
{
  "version": "2.4.0",
  "tag": "v2.4.0",
  "previous_version": "2.3.0",
  "source_commit": "…",
  "release_commit": "…",
  "gate": { "status": "passed", "summary": "总结: pass=915 fail=0" },
  "schema_manifest_sha256": "…",
  "commits_since_previous_tag": 135
}
```

## 5. 部署与回滚

- 部署：`bash scripts/deploy.sh`（门禁 → migration → 滚动重启 → 健康检查）；
- 发布 tag 只用于“可部署版本标识”，部署仍走 deploy 脚本；
- 应用回滚：
  ```bash
  git checkout v2.3.0
  bash scripts/deploy.sh --test-only
  bash scripts/deploy.sh
  ```
- 数据库：migration 只向前；回滚应用前先确认 schema 兼容；发布前应做数据库备份；
- 发布失败：保留本地 commit/tag，修复 push 后重试；不移动已推送 tag。

## 6. CI 与门禁

- 提交前/推送前已有测试闸门；
- release 脚本自身默认跑 `scripts/pre-deploy-test.sh`；
- `.github/workflows/test.yml` 负责 CI 测试；
- 后续可增加 tag 触发构建/发布产物。

## 7. 当前版本

- 上一正式版本：`v2.3.0`（2026-10-11）；
- 本批次：**v2.4.0**（2026-11-08）；
- 包含 BOM 双 BOM、文档 P0/P1/P1P2、严格文档版本管理、工艺树升级、UI/UX 与模块审计整改。

## 8. 禁止事项

1. 不在脏工作树上发布（除显式 `--allow-dirty`）；
2. 不重复使用/移动已发布 tag；
3. 不跳过闸门发布（除非显式 `--skip-test` 且已手动验证）；
4. 不直接把 `main` 部署到生产而不留 tag；
5. 不在没有数据库备份的情况下做不兼容 migration。
