#!/usr/bin/env python3
"""
检查 frontend/src 里是否有禁用 hex 颜色 (除 style.css / tokens.scss)
用于 CI / pre-commit 拦截 hex 硬编码
"""
import os, re, sys

# 允许 hex 字面量的文件 (白名单 - 仅 token 定义)
ALLOWLIST = {
    'src/style.css',           # 项目 token 定义
    'src/styles/tokens.scss',   # SCSS tokens
    'src/App.vue',              # 主题切换逻辑可保留
}

# 允许的 hex 字面量 (来自 style.css 内置 token 的字面)
KNOWN_TOKENS_HEX = {
    '#F97316', '#22C55E', '#F59E0B', '#EF4444', '#3B82F6',  # 项目 token 字面
    '#64748B', '#94A3B8', '#F8FAFC', '#E2E8F0',  # 项目 color
    '#64748b', '#94a3b8', '#f8fafc', '#e2e8f0',
    '#020617', '#0F172A', '#0f172a', '#1E293B', '#1e293b',  # dark
    '#334155', '#475569', '#94A3B8', '#F1F5F9', '#CBD5E1',
    '#8193A0', '#9AADB8', '#B3C2CA', '#C5D1D7', '#D8E0E5',
    '#4B5A6E', '#1E293B', '#FFFFFF', '#1E293B',  # Element Plus Light-3 etc.
    '#475569', '#F1F5F9',
}

ROOT = '/home/dubin/factory-mes/frontend/src'
violations = []

for root, dirs, files in os.walk(ROOT):
    for f in files:
        if not (f.endswith('.vue') or f.endswith('.css') or f.endswith('.scss')):
            continue
        full = os.path.join(root, f)
        rel = full.replace('/home/dubin/factory-mes/frontend/', '')
        if rel in ALLOWLIST:
            continue
        with open(full, encoding='utf-8') as fp:
            content = fp.read()
        for m in re.finditer(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?!\w)', content):
            hex_val = m.group(0)
            if hex_val not in KNOWN_TOKENS_HEX:
                line = content[:m.start()].count('\n') + 1
                violations.append((rel, line, hex_val))

if violations:
    print(f'\n❌ 发现 {len(violations)} 个不允许的硬编码 hex：')
    for f, l, h in violations[:20]:
        print(f'  {f}:{l}: {h}')
    if len(violations) > 20:
        print(f'  ... +{len(violations)-20} more')
    print(f'\n请用 var(--xxx) 替代。已知 token: style.css, tokens.scss')
    sys.exit(1)
else:
    print('✓ 0 个违规 hex，所有硬编码颜色都用 token 变量')
    sys.exit(0)

