#!/usr/bin/env node
"use strict";
// 开发期工具（不参与运行时）。用法见 scripts/dev/README.md。
// .tmp/astdecls.js —— AST 版"顶层声明搬移器"（给不是 register 闭包的文件用）
//
// 场景：iotCollector.js 这类模块 —— 19 个顶层函数 + 2 个可变模块状态
//   (collectorInterval / dbRef)。把"不依赖可变状态"的纯函数搬到 _helpers.js，
//   有状态的留在 index.js。
//
// 判定完全基于 AST 作用域：某声明若引用了"要留在原地的顶层名字"或"可变状态"，就不搬。
// 核对：导出面一致 + 语法 + 可加载；不符自动回滚。

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");

// @babel/parser：仓库里没有独立 acorn（Vite 7 换 rolldown 了），
// 但 frontend 的依赖树里有 @babel/parser。优先用本地依赖，其次用 frontend 里的。
function loadParser() {
  try {
    return require("@babel/parser");
  } catch (error) {
    return require(path.join(ROOT, "frontend", "node_modules", "@babel", "parser"));
  }
}
const parser = loadParser();

const APPLY = process.argv.includes("--apply");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!args.length) {
  console.error("用法: node " + path.relative(ROOT, __filename) + " <相对文件路径> [--apply]");
  process.exit(1);
}

const FILES = args;

const GLOBALS = new Set([
  "undefined", "NaN", "Infinity", "globalThis", "eval", "JSON", "Math", "Object", "Array",
  "String", "Number", "Boolean", "Date", "Set", "Map", "WeakMap", "WeakSet", "Promise", "RegExp",
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "Symbol", "BigInt",
  "Function", "Proxy", "Reflect", "Intl", "parseInt", "parseFloat", "isNaN", "isFinite",
  "console", "process", "Buffer", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "setImmediate", "clearImmediate", "queueMicrotask", "structuredClone", "require", "module",
  "exports", "__dirname", "__filename", "global", "URL", "URLSearchParams", "fetch", "crypto",
  "performance", "arguments", "ArrayBuffer", "Uint8Array", "Int32Array", "Float64Array",
]);

function walkChildren(node, cb) {
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item.type === "string") cb(item, key);
    } else if (value && typeof value.type === "string") cb(value, key);
  }
}

function patternNames(node, out = new Set()) {
  if (!node) return out;
  switch (node.type) {
    case "Identifier": out.add(node.name); break;
    case "ObjectPattern":
      for (const p of node.properties) patternNames(p.type === "RestElement" ? p.argument : p.value, out);
      break;
    case "ArrayPattern": for (const el of node.elements) patternNames(el, out); break;
    case "AssignmentPattern": patternNames(node.left, out); break;
    case "RestElement": patternNames(node.argument, out); break;
    default: break;
  }
  return out;
}

function freeNames(subtree) {
  const declared = new Set();
  const referenced = new Set();
  function visit(node) {
    if (!node || typeof node.type !== "string") return;
    switch (node.type) {
      case "Identifier": referenced.add(node.name); return;
      case "MemberExpression":
      case "OptionalMemberExpression":
        visit(node.object);
        if (node.computed) visit(node.property);
        return;
      case "ObjectProperty":
      case "ClassProperty":
      case "ObjectMethod":
      case "ClassMethod":
        if (node.computed) visit(node.key);
        if (node.value) visit(node.value);
        if (node.type === "ObjectMethod") visit(node.body);
        return;
      case "VariableDeclarator":
        patternNames(node.id, declared);
        if (node.init) visit(node.init);
        return;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node.id) declared.add(node.id.name);
        for (const p of node.params) patternNames(p, declared);
        visit(node.body);
        return;
      case "ClassDeclaration":
      case "ClassExpression":
        if (node.id) declared.add(node.id.name);
        visit(node.body);
        return;
      case "CatchClause":
        patternNames(node.param, declared);
        visit(node.body);
        return;
      case "LabeledStatement": visit(node.body); return;
      case "BreakStatement":
      case "ContinueStatement":
      case "ImportDeclaration":
        return;
      default:
        walkChildren(node, visit);
    }
  }
  visit(subtree);
  for (const name of declared) referenced.delete(name);
  return referenced;
}

function topLevelRequires(ast, src) {
  const map = new Map();
  for (const node of ast.program.body) {
    if (node.type !== "VariableDeclaration") continue;
    const text = src.slice(node.start, node.end);
    if (!/require\(/.test(text)) continue;
    for (const d of node.declarations) for (const n of patternNames(d.id)) map.set(n, text);
  }
  return map;
}

function shiftRequires(text) {
  return text.replace(/require\((['"])((?:\.\.\/|\.\/)*)([^'"]*)/g, (all, quote, prefix, rest) => {
    if (!prefix) return all;
    const next = prefix.startsWith("./") ? "../" : "../" + prefix;
    return `require(${quote}${next}${rest}`;
  });
}

function snapshot(target) {
  try {
    return execFileSync("node", ["-e", `console.log(JSON.stringify(Object.keys(require('./${target}')).sort()))`],
      { cwd: ROOT, encoding: "utf8" }).trim();
  } catch (error) {
    return "LOAD_FAIL:" + String(error.message).slice(0, 200);
  }
}

for (const rel of FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) { console.log(`${rel}  跳过：已拆分`); continue; }
  const src = fs.readFileSync(full, "utf8");
  const ast = parser.parse(src, { sourceType: "script", errorRecovery: true });
  const decls = [];
  for (const node of ast.program.body) {
    if (node.type === "FunctionDeclaration" && node.id) {
      decls.push({ names: new Set([node.id.name]), node, kind: "function" });
    } else if (node.type === "VariableDeclaration") {
      const names = patternNames(node.declarations[0].id, new Set());
      for (const d of node.declarations) patternNames(d.id, names);
      // 一条声明可能含多个 declarator，这里按整条语句处理
      decls.push({ names, node, kind: node.kind });
    }
  }
  const allNames = new Set();
  for (const d of decls) for (const n of d.names) allNames.add(n);
  const mutable = new Set();
  for (const d of decls) if (d.kind === "let" || d.kind === "var") for (const n of d.names) mutable.add(n);
  const requires = topLevelRequires(ast, src);

  // 迭代求"可搬移语句集合"：以**语句**为单位（一条 const 可能声明多个名字，
  // 例如 const { emit, Events } = require(...) —— 按名字拆会把 Events 落下）
  const declOfName = new Map();
  for (const d of decls) for (const n of d.names) declOfName.set(n, d);
  // require 绑定本身不搬（避免 _helpers 里出现重复声明）；引用它们的声明照搬，
  // 由下面 neededReq 把对应 require 复制进 _helpers.js
  const isRequireDecl = (entry) =>
    entry.node.type === "VariableDeclaration" &&
    entry.node.declarations.some(
      (d) => d.init && d.init.type === "CallExpression" && d.init.callee && d.init.callee.name === "require"
    );
  let movable = new Set(decls.filter((d) => !isRequireDecl(d) && ![...d.names].some((n) => mutable.has(n))));
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of [...movable]) {
      const free = freeNames(entry.node);
      const bad = [...free].some((n) => {
        if (mutable.has(n)) return true;
        if (!allNames.has(n)) return false;             // 不是顶层名字（局部/require/全局）
        const owner = declOfName.get(n);
        return owner ? !movable.has(owner) : false;      // 依赖了留在原地的顶层声明
      });
      if (bad) { movable.delete(entry); changed = true; }
    }
  }
  const movedNames = new Set();
  for (const entry of movable) for (const n of entry.names) movedNames.add(n);

  const movableDecls = [...movable].sort((a, b) => a.node.start - b.node.start);
  const movedLines = movableDecls.reduce((sum, d) => sum + src.slice(d.node.start, d.node.end).split("\n").length, 0);
  const totalLines = src.split("\n").length;
  console.log(`${rel}  总 ${totalLines} 行；可搬 ${movableDecls.length} 条 / ${movedLines} 行 -> ${[...movedNames].sort().join(", ")}`);
  console.log(`   留在原地: ${[...allNames].filter((n) => !movedNames.has(n)).sort().join(", ")}`);
  if (!APPLY || !movable.size) continue;

  const before = snapshot(rel.replace(/\.js$/, ""));
  const stem = path.basename(full, ".js");
  const outDir = path.join(path.dirname(full), stem);
  fs.mkdirSync(outDir, { recursive: true });

  const neededReq = new Set();
  for (const d of movableDecls) {
    for (const n of freeNames(d.node)) {
      if (requires.has(n) && !movedNames.has(n)) neededReq.add(n);
    }
  }
  const helper =
    '"use strict";\n// 从 ' + rel + ' 搬出的纯声明（不引用模块可变状态）\n\n' +
    [...neededReq].map((n) => shiftRequires(requires.get(n))).join("\n") +
    "\n\n" + movableDecls.map((d) => shiftRequires(src.slice(d.node.start, d.node.end))).join("\n\n") +
    "\n\nmodule.exports = { " + [...movedNames].sort().join(", ") + " };\n";
  fs.writeFileSync(path.join(outDir, "_helpers.js"), helper);

  // index.js：删掉搬走的声明，插入 require
  let out = "";
  let cursor = 0;
  for (const d of movableDecls.sort((a, b) => a.node.start - b.node.start)) {
    out += src.slice(cursor, d.node.start);
    cursor = d.node.end;
  }
  out += src.slice(cursor);
  out = shiftRequires(out);                       // 文件下沉一层，相对 require 要加深
  const header = 'const { ' + [...movedNames].sort().join(", ") + ' } = require("./_helpers");\n';
  const reqMatches = [...out.matchAll(/^(?:const|let|var)[^\n]*require\([^\n]*\);\s*$/gm)];
  const at = reqMatches.length ? reqMatches[reqMatches.length - 1].index + reqMatches[reqMatches.length - 1][0].length : 0;
  out = out.slice(0, at) + "\n" + header + out.slice(at);
  fs.writeFileSync(path.join(outDir, "index.js"), out);
  fs.unlinkSync(full);

  const after = snapshot(rel.replace(/\.js$/, ""));
  let syntaxOk = true;
  for (const f of fs.readdirSync(outDir)) {
    try { execFileSync("node", ["--check", path.join(outDir, f)], { encoding: "utf8" }); }
    catch (error) { syntaxOk = false; console.log("   语法失败", f, String(error.stderr || "").slice(0, 200)); }
  }
  if (before !== after || !syntaxOk) {
    console.log(`   ❌ 核对失败 before=${before} after=${after}`);
    execFileSync("git", ["checkout", "--", rel], { cwd: ROOT });
    fs.rmSync(outDir, { recursive: true, force: true });
  } else {
    console.log(`   ✅ index.js ${out.split("\n").length} 行 + _helpers.js ${helper.split("\n").length} 行；导出一致`);
  }
}
