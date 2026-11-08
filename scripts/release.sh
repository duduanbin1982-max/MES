#!/usr/bin/env bash
# scripts/release.sh
# TBM-MES 正式发布脚本：版本号、CHANGELOG、发布台账、commit、annotated tag、push。
#
# 用法：
#   bash scripts/release.sh --minor --dry-run     # 预览（仍会跑部署闸门）
#   bash scripts/release.sh --minor               # 正式发布 2.4.0（示例）
#   bash scripts/release.sh --patch
#   bash scripts/release.sh --major
#   bash scripts/release.sh --version 2.4.0
#   bash scripts/release.sh --minor --skip-test   # 已手动跑过闸门时
#   bash scripts/release.sh --minor --no-push     # 只生成 commit/tag，不推送
#
# 规则：
# - 只允许在 main 分支、干净工作树、目标 tag 不存在时发布；
# - 默认运行 scripts/pre-deploy-test.sh，失败即中止；
# - 更新 VERSION / package.json / package-lock.json / CHANGELOG.md；
# - 生成 releases/vX.Y.Z.json 发布台账（含 commit、闸门结果、schema 指纹）；
# - 生成 annotated tag vX.Y.Z；
# - 推送 main + tag（可用 --no-push 关闭）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TARGET_VERSION=""
BUMP=""
DRY_RUN=0
SKIP_TEST=0
NO_PUSH=0
ALLOW_DIRTY=0
ALLOW_BRANCH=0
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
VERSION_FILE="$ROOT/VERSION"
CHANGELOG_FILE="$ROOT/CHANGELOG.md"
RELEASES_DIR="$ROOT/releases"

usage() {
  cat <<'EOF'
用法: bash scripts/release.sh [--minor|--major|--patch|--version X.Y.Z] [选项]

选项:
  --dry-run        只打印计划，不修改文件/提交/tag（默认仍跑测试闸门）
  --skip-test      跳过 scripts/pre-deploy-test.sh（仅限已手动跑过闸门）
  --no-push        不执行 git push（本地生成 commit/tag）
  --allow-dirty    允许工作树有未提交改动（不推荐）
  --allow-branch   允许在非 main 分支发布（不推荐）
  -h, --help       显示帮助
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --major|--minor|--patch) BUMP="${1#--}"; shift ;;
    --version) TARGET_VERSION="${2#v}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-test) SKIP_TEST=1; shift ;;
    --no-push) NO_PUSH=1; shift ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --allow-branch) ALLOW_BRANCH=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1"; usage; exit 1 ;;
  esac
done

fail() { echo "❌ $*" >&2; exit 1; }
info() { echo "  $*"; }

if [ -z "$TARGET_VERSION" ] && [ -z "$BUMP" ]; then
  fail "必须指定 --major/--minor/--patch 或 --version X.Y.Z"
fi
if [ -n "$TARGET_VERSION" ] && [ -n "$BUMP" ]; then
  fail "--version 与 --major/--minor/--patch 不能同时使用"
fi

# 当前版本：VERSION 优先，缺失时退回 package.json
CURRENT_VERSION=""
if [ -f "$VERSION_FILE" ]; then
  CURRENT_VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
fi
if [ -z "$CURRENT_VERSION" ] && [ -f "$ROOT/package.json" ]; then
  CURRENT_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
fi
[ -n "$CURRENT_VERSION" ] || fail "无法确定当前版本（VERSION 与 package.json 都不可用）"
echo "$CURRENT_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "当前版本不是 SemVer: $CURRENT_VERSION"

if [ -n "$TARGET_VERSION" ]; then
  echo "$TARGET_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "目标版本不是 SemVer: $TARGET_VERSION"
else
  IFS=. read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
  case "$BUMP" in
    major) TARGET_VERSION="$((MAJOR + 1)).0.0" ;;
    minor) TARGET_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    patch) TARGET_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
  esac
fi

TAG="v$TARGET_VERSION"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  fail "tag $TAG 已存在，不能重复发布"
fi
if ! node -e '
const [a,b]=process.argv.slice(1).map(v=>v.split(".").map(Number));
for(let i=0;i<3;i++){ if(a[i]!==b[i]){ process.exit(a[i]<b[i]?0:1); } }
process.exit(1);
' "$CURRENT_VERSION" "$TARGET_VERSION"; then
  fail "目标版本 $TARGET_VERSION 必须大于当前版本 $CURRENT_VERSION"
fi

if [ "$BRANCH" != "main" ] && [ "$ALLOW_BRANCH" != "1" ]; then
  fail "当前分支是 $BRANCH，正式发布只允许 main（或加 --allow-branch）"
fi

DIRTY_PATHS="$(git status --porcelain --untracked-files=all || true)"
if [ -n "$DIRTY_PATHS" ] && [ "$ALLOW_DIRTY" != "1" ]; then
  echo "工作树包含未提交改动："
  printf '%s\n' "$DIRTY_PATHS" | head -40
  fail "请先提交/清理工作树（或加 --allow-dirty）"
fi

SOURCE_COMMIT="$(git rev-parse HEAD)"
LAST_TAG="$(git describe --tags --abbrev=0 --match 'v*' HEAD 2>/dev/null || true)"
COMMIT_COUNT=0
if [ -n "$LAST_TAG" ]; then
  COMMIT_COUNT="$(git rev-list --count "$LAST_TAG..$SOURCE_COMMIT" 2>/dev/null || echo 0)"
else
  COMMIT_COUNT="$(git rev-list --count "$SOURCE_COMMIT" 2>/dev/null || echo 0)"
fi

CHANGELOG_NEEDS_SECTION=0
if [ ! -f "$CHANGELOG_FILE" ] || ! grep -Eq "^## \[${TARGET_VERSION}\]" "$CHANGELOG_FILE"; then
  CHANGELOG_NEEDS_SECTION=1
fi

echo "=========================================="
echo " TBM-MES 发布计划"
echo " 当前版本: $CURRENT_VERSION"
echo " 目标版本: $TARGET_VERSION"
echo " tag:      $TAG"
echo " 分支:     $BRANCH"
echo " 源提交:   $SOURCE_COMMIT"
echo " 上个 tag: ${LAST_TAG:-（无）}"
echo " 提交数:   $COMMIT_COUNT"
echo " CHANGELOG: $([ "$CHANGELOG_NEEDS_SECTION" = "1" ] && echo '将自动生成目标版本小节' || echo '已存在目标版本小节')"
echo "=========================================="

run_gate_if_needed() {
  if [ "$SKIP_TEST" = "1" ]; then
    echo "⚠️  已跳过测试闸门（--skip-test）"
    TEST_SUMMARY="skipped (--skip-test)"
    return 0
  fi
  local log
  log="$(mktemp -t mes-release-gate-XXXXXX.log)"
  echo "[gate] 运行 scripts/pre-deploy-test.sh ..."
  if ! bash "$ROOT/scripts/pre-deploy-test.sh" > "$log" 2>&1; then
    echo "❌ 测试闸门失败，发布中止。日志尾部："
    tail -60 "$log" >&2
    rm -f "$log"
    exit 1
  fi
  TEST_SUMMARY="$(grep -E '总结: pass=' "$log" | tail -1 | sed 's/^[[:space:]]*//' || true)"
  [ -n "$TEST_SUMMARY" ] || TEST_SUMMARY="passed"
  rm -f "$log"
  echo "✅ 测试闸门通过: $TEST_SUMMARY"
}

run_gate_if_needed

if [ "$DRY_RUN" = "1" ]; then
  echo "------------------------------------------"
  echo "DRY-RUN（未修改任何文件）"
  echo "将执行："
  info "1) 写入 VERSION = $TARGET_VERSION"
  info "2) 更新 package.json / package-lock.json version = $TARGET_VERSION"
  if [ "$CHANGELOG_NEEDS_SECTION" = "1" ]; then
    info "3) 在 CHANGELOG.md 生成 [${TARGET_VERSION}] 小节（来自 $LAST_TAG..HEAD 的 conventional commits）"
  else
    info "3) CHANGELOG.md 已包含 [${TARGET_VERSION}] 小节，保留现有内容"
  fi
  info "4) git commit -m 'chore(release): v$TARGET_VERSION'"
  info "5) 生成 releases/$TAG.json 发布台账并 commit"
  info "6) git tag -a $TAG"
  info "7) $([ "$NO_PUSH" = "1" ] && echo '跳过 push（--no-push）' || echo 'git push origin main && git push origin '"$TAG")"
  echo "------------------------------------------"
  echo "✅ DRY-RUN 通过：版本、tag、CHANGELOG、工作树、闸门检查均正常"
  exit 0
fi

echo "[1/7] 更新版本文件 ..."
printf '%s\n' "$TARGET_VERSION" > "$VERSION_FILE"
node - "$TARGET_VERSION" <<'NODE'
const fs = require("node:fs");
const version = process.argv[2];
for (const file of ["package.json", "package-lock.json"]) {
  if (!fs.existsSync(file)) continue;
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  json.version = version;
  if (json.packages && json.packages[""]) json.packages[""].version = version;
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
NODE

echo "[2/7] 更新 CHANGELOG ..."
if [ "$CHANGELOG_NEEDS_SECTION" = "1" ]; then
  DATE="$(date +%F)"
  NOTES_FILE="$(mktemp -t mes-release-notes-XXXXXX.md)"
  {
    echo "## [$TARGET_VERSION] - $DATE"
    echo ""
    if [ -n "$LAST_TAG" ]; then
      RANGE="$LAST_TAG..HEAD"
    else
      RANGE="HEAD"
    fi
    # 按 conventional commit 前缀分组；忽略 release 自身的机械提交
    for group in "Added:feat" "Fixed:fix" "Changed:perf|refactor" "Docs:docs" "Tests:test"; do
      LABEL="${group%%:*}"
      PATTERN="${group#*:}"
      SUBJECTS="$(git log "$RANGE" --pretty=format:'%s' | grep -Ev '^chore\(release\)' | grep -E "^($PATTERN)(\(|:|!)" || true)"
      if [ -n "$SUBJECTS" ]; then
        echo "### $LABEL"
        echo ""
        printf '%s\n' "$SUBJECTS" | while IFS= read -r subject; do
          subject="${subject#*: }"
          echo "- $subject"
        done
        echo ""
      fi
    done
  } > "$NOTES_FILE"
  if [ ! -f "$CHANGELOG_FILE" ]; then
    printf '# Changelog\n\n本文件记录 TBM-MES 的正式发布版本与主要变更。\n\n' > "$CHANGELOG_FILE"
  fi
  TMP_CHANGELOG="$(mktemp -t mes-release-changelog-XXXXXX.md)"
  awk -v notes="$NOTES_FILE" '
    BEGIN { inserted = 0 }
    /^## \[/ && inserted == 0 {
      while ((getline line < notes) > 0) print line
      close(notes)
      print ""
      inserted = 1
    }
    { print }
    END {
      if (inserted == 0) {
        while ((getline line < notes) > 0) print line
        close(notes)
      }
    }
  ' "$CHANGELOG_FILE" > "$TMP_CHANGELOG"
  mv "$TMP_CHANGELOG" "$CHANGELOG_FILE"
  rm -f "$NOTES_FILE"
  echo "  ✅ 已生成 CHANGELOG [$TARGET_VERSION]"
else
  echo "  ℹ️  CHANGELOG 已包含 [$TARGET_VERSION]，保留现有内容"
fi

echo "[3/7] 提交版本变更 ..."
git add "$VERSION_FILE" package.json package-lock.json "$CHANGELOG_FILE" 2>/dev/null || git add "$VERSION_FILE" package.json "$CHANGELOG_FILE"
git commit --no-verify -m "chore(release): v$TARGET_VERSION"
RELEASE_COMMIT="$(git rev-parse HEAD)"

echo "[4/7] 生成发布台账 ..."
mkdir -p "$RELEASES_DIR"
SCHEMA_HASH="$(sha256sum db/service-schema-manifest.json 2>/dev/null | awk '{print $1}')"
RELEASED_AT="$(date -Iseconds)"
node - "$TARGET_VERSION" "$TAG" "$CURRENT_VERSION" "$SOURCE_COMMIT" "$RELEASE_COMMIT" "$BRANCH" "$TEST_SUMMARY" "$SCHEMA_HASH" "$COMMIT_COUNT" "$LAST_TAG" <<'NODE'
const fs = require("node:fs");
const [version, tag, previous, sourceCommit, releaseCommit, branch, testSummary, schemaHash, commitCount, lastTag] = process.argv.slice(2);
const ledger = {
  version,
  tag,
  previous_version: previous,
  branch,
  released_at: new Date().toISOString(),
  source_commit: sourceCommit,
  release_commit: releaseCommit,
  previous_tag: lastTag || null,
  commits_since_previous_tag: Number(commitCount) || 0,
  gate: { status: testSummary.startsWith("skipped") ? "skipped" : "passed", summary: testSummary },
  schema_manifest_sha256: schemaHash || null,
  changelog: "CHANGELOG.md",
  deployment: { command: "bash scripts/deploy.sh", status: "not_deployed_by_release_script" }
};
fs.writeFileSync(`releases/${tag}.json`, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`  ✅ releases/${tag}.json`);
NODE
git add "$RELEASES_DIR/$TAG.json"
git commit --no-verify -m "chore(release): record $TAG"

echo "[5/7] 创建 annotated tag ..."
git tag -a "$TAG" -m "release $TAG ($(date +%F))"
echo "  ✅ $(git for-each-ref "refs/tags/$TAG" --format='%(refname:short) → %(objectname:short)')"

echo "[6/7] 推送 ..."
if [ "$NO_PUSH" = "1" ]; then
  echo "  ⏭  已跳过 push（--no-push）"
  echo "  手动推送: git push origin $BRANCH && git push origin $TAG"
else
  if git push origin "$BRANCH" && git push origin "$TAG"; then
    echo "  ✅ 已推送 $BRANCH 与 $TAG"
  else
    echo "  ❌ push 失败；本地 commit/tag 已保留，可稍后重试："
    echo "     git push origin $BRANCH && git push origin $TAG"
    exit 1
  fi
fi

echo "[7/7] 完成"
echo "=========================================="
echo " 发布版本: $TARGET_VERSION"
echo " tag:      $TAG"
echo " 台账:     releases/$TAG.json"
echo " 下一步:   bash scripts/deploy.sh"
echo "=========================================="
