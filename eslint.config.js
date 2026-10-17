// eslint.config.js —— 后端 ESLint flat config（ESLint 10）
// 2026-10-17 落地（方案 W3-5）：只覆盖后端 Node 代码；前端由 vue-tsc + test:domain 把关。
// 目标：
//   1) 守住"统一日志出口"（no-console）——与 tests/logging.test.js 的 LOG.8 守卫同源
//   2) 守住《架构规则》第 5 条"业务函数内禁止 require('../db')"
//   3) 逐步收敛存量风格问题（no-var / prefer-const 自动修；eqeqeq 先 warn 观察）
"use strict";

const globals = require("globals");
const js = require("@eslint/js");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "node_modules.before-lint/**",
      "frontend/**",
      "attic/**",
      "archive/**",
      ".codex-backups/**",
      ".tmp/**",
      "backups/**",
      "data/**",
      "logs/**",
      "coverage/**",
      "dist/**",
      "*.before-lint",
    ],
  },

  js.configs.recommended,

  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      // —— 项目约定（error 级，CI 与部署闸门强制）——
      "no-console": "error",
      "no-var": "error",
      "prefer-const": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='require'] > Literal[value='../db']",
          message: "禁止在业务函数内 require('../db')：db 由装配层注入（docs/architecture-rules.md 第 5 条）",
        },
        {
          selector: "CallExpression[callee.name='require'] > Literal[value='../../db']",
          message: "禁止在业务函数内 require('../../db')：db 由装配层注入（docs/architecture-rules.md 第 5 条）",
        },
      ],
      eqeqeq: ["error", "smart"],
    },
  },

  // 日志出口本身允许 console（当前实现在 app/logger.js 之外还有注释说明，保持显式豁免）
  {
    files: ["app/logger.js"],
    rules: { "no-console": "off" },
  },

  // 测试与运维脚本：允许 console 输出、放宽未使用变量（与 LOG.8 守卫的豁免范围一致）
  {
    files: ["tests/**/*.js", "scripts/**/*.js", "scripts/dev/**/*.js", "seed-*.js", "seed-demo.js", "migrate.js", "inspect-nodes.js", "tmp_*.js", "benchmark.js"],
    rules: {
      "no-console": "off",
    },
  },
];
