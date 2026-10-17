// eslint.config.js —— 前端（Vue 3 + TS）ESLint flat config（2026-10-17 落地）
// 覆盖 133 个 .vue + 55 个 .ts + 3 个 domain 测试；与后端 eslint.config.js 分开维护。
//
// 设计取向：
//   1) 只用"正确性"规则（plugin-vue 的 flat/essential），**不开** flat/recommended 的格式类规则，
//      避免一次性制造上千条缩进/换行告警（格式由人把握，必要时 npx prettier --write <文件>）
//   2) TS 侧用 typescript-eslint recommended（非 type-checked，保证 lint 速度；类型正确性由 vue-tsc 负责）
//   3) 存量问题先 warn（与后端棘轮同一套做法），error 清零后再升 strict
import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist.next/**",
      "dist.prev/**",
      "node_modules/**",
      "package.json.before-eslint",
      "package-lock.json.before-eslint",
    ],
  },

  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/essential"],

  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".vue"],
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
  },

  {
    files: ["**/*.{ts,vue}"],
    rules: {
      // TS 已能发现未定义标识符；浏览器全局由 vue-tsc 的 DOM lib 提供
      "no-undef": "off",
      // 存量：先 warn，清零后升 error（见 docs/lint-and-ci.md 的棘轮表）
      "@typescript-eslint/no-unused-vars": ["warn", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
      "vue/no-unused-vars": "warn",
      "vue/no-unused-components": "warn",
      // 现有多为单词组件名（Gantt / GanttChart 之外的视图），不强求多词
      "vue/multi-word-component-names": "off",
      // 项目大量使用 any（历史代码 + Element Plus 回调），先不引入噪音
      "@typescript-eslint/no-explicit-any": "off",
      // 关键正确性规则保持 error
      "vue/require-v-for-key": "error",
      // 存量 151 处：约 20 个弹窗组件直接改写传入的 form 对象。
      // 正确做法是 defineModel/emit 或 local reactive 副本 + watch 同步，
      // 属设计级重构且必须逐组件 GUI 复核；先 warn，按目录分批收敛（见 docs/lint-and-ci.md）。
      "vue/no-mutating-props": "warn",
      "vue/no-side-effects-in-computed-properties": "error",
      "no-console": "warn",
    },
  },

  // 手写 shim：从 @vue/runtime-dom / @vue/reactivity 直接引入是它的职责
  {
    files: ["src/vue-shim.js"],
    rules: {
      "vue/prefer-import-from-vue": "off",
    },
  },

  // domain 测试：允许 console 与 nodes 相关写法
  {
    files: ["tests/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
