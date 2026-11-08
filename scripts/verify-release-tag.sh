#!/usr/bin/env bash
# scripts/verify-release-tag.sh
# 校验 Git tag 与发布产物一致性（CI tag 触发 / 本地手工均可）。
#
# 用法：
#   bash scripts/verify-release-tag.sh v2.4.0
#   bash scripts/verify-release-tag.sh v2.4.0 --require-head
#
# 校验项：
# - tag 存在且为 annotated tag；
# - tag 名 = vX.Y.Z；
# - VERSION / package.json / package-lock.json 版本一致；
# - CHANGELOG.md 含 "## [X.Y.Z]" 小节；
# - releases/vX.Y.Z.json 存在，version/tag 匹配，闸门状态 passed；
# - release_commit 存在且是 tag commit 的祖先；
# - --require-head 时 tag commit 必须等于当前 HEAD（CI 检出 tag 时使用）。
set -euo pipefail

TAG="${1:-}"
REQUIRE_HEAD=0
if [ "${2:-}" = "--require-head" ]; then REQUIRE_HEAD=1; fi
if [ -z "$TAG" ]; then
  echo "用法: bash scripts/verify-release-tag.sh vX.Y.Z [--require-head]" >&2
  exit 2
fi
TAG="${TAG#refs/tags/}"

fail() { echo "❌ 发布 tag 校验失败: $*" >&2; exit 1; }
info() { echo "  ✅ $*"; }

echo "=========================================="
echo " 发布 tag 校验: $TAG"
echo "=========================================="

echo "$TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail "tag 必须形如 vX.Y.Z"
VERSION="${TAG#v}"

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || fail "tag 不存在: $TAG"
[ "$(git cat-file -t "$TAG")" = "tag" ] || fail "必须是 annotated tag（当前不是 tag 对象）"
info "tag 存在，类型 annotated"

TAG_COMMIT="$(git rev-parse "$TAG^{commit}")"
if [ "$REQUIRE_HEAD" = "1" ]; then
  HEAD_COMMIT="$(git rev-parse HEAD)"
  [ "$TAG_COMMIT" = "$HEAD_COMMIT" ] || fail "tag commit $TAG_COMMIT 与当前 HEAD $HEAD_COMMIT 不一致"
  info "tag commit 与当前 HEAD 一致: ${TAG_COMMIT:0:7}"
fi

TAG_VERSION="$(git show "$TAG:VERSION" 2>/dev/null | tr -d '[:space:]')"
[ -n "$TAG_VERSION" ] || fail "tag 中缺少 VERSION 文件"
[ "$TAG_VERSION" = "$VERSION" ] || fail "VERSION=$TAG_VERSION 与 tag 版本 $VERSION 不一致"
info "VERSION=$TAG_VERSION"

PKG_VERSION="$(git show "$TAG:package.json" | node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(0,"utf8")).version)')"
[ "$PKG_VERSION" = "$VERSION" ] || fail "package.json version=$PKG_VERSION 与 tag 版本 $VERSION 不一致"
info "package.json=$PKG_VERSION"

LOCK_VERSION="$(git show "$TAG:package-lock.json" 2>/dev/null | node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(j.packages&&j.packages[""]?j.packages[""].version:j.version)')"
[ "$LOCK_VERSION" = "$VERSION" ] || fail "package-lock.json version=$LOCK_VERSION 与 tag 版本 $VERSION 不一致"
info "package-lock.json=$LOCK_VERSION"

CHANGELOG="$(git show "$TAG:CHANGELOG.md" 2>/dev/null || true)"
[ -n "$CHANGELOG" ] || fail "tag 中缺少 CHANGELOG.md"
printf '%s\n' "$CHANGELOG" | grep -Eq "^## \[${VERSION}\]" || fail "CHANGELOG.md 缺少 [${VERSION}] 小节"
info "CHANGELOG 含 [${VERSION}] 小节"

LEDGER_PATH="releases/${TAG}.json"
LEDGER="$(git show "$TAG:${LEDGER_PATH}" 2>/dev/null || true)"
[ -n "$LEDGER" ] || fail "tag 中缺少发布台账 $LEDGER_PATH"
LEDGER_JSON="$LEDGER" node - "$VERSION" "$TAG" <<'NODE'
const [expectedVersion, expectedTag] = process.argv.slice(2);
const ledger = JSON.parse(process.env.LEDGER_JSON);
const errors = [];
if (ledger.version !== expectedVersion) errors.push(`ledger.version=${ledger.version} != ${expectedVersion}`);
if (ledger.tag !== expectedTag) errors.push(`ledger.tag=${ledger.tag} != ${expectedTag}`);
if (!ledger.gate || ledger.gate.status !== "passed") errors.push(`gate.status=${ledger.gate && ledger.gate.status} != passed`);
if (!ledger.release_commit || !/^[0-9a-f]{7,40}$/.test(ledger.release_commit)) errors.push("release_commit 非法");
if (errors.length) {
  console.error("❌ 发布台账校验失败:");
  for (const error of errors) console.error("  - " + error);
  process.exit(1);
}
console.log(`  ✅ 发布台账 ${expectedTag}.json: version/tag/gate/release_commit 正常`);
NODE

RELEASE_COMMIT="$(LEDGER_JSON="$LEDGER" node -e 'process.stdout.write(JSON.parse(process.env.LEDGER_JSON).release_commit)')"
git cat-file -e "${RELEASE_COMMIT}^{commit}" 2>/dev/null || fail "ledger.release_commit 不存在: $RELEASE_COMMIT"
git merge-base --is-ancestor "$RELEASE_COMMIT" "$TAG_COMMIT" || fail "release_commit $RELEASE_COMMIT 不是 tag commit 的祖先"
info "release_commit ${RELEASE_COMMIT:0:7} 是 tag commit 祖先"

echo "------------------------------------------"
echo "✅ 发布 tag 校验通过: $TAG（版本 $VERSION，commit ${TAG_COMMIT:0:7}）"
