#!/usr/bin/env node
"use strict";
// 开发期工具（不参与运行时）。用法见 scripts/dev/README.md。
// .tmp/astinner.js —— 把工厂函数内部的小函数提升到 _helpers.js（AST 版）
//
// 目标：services/delivery/readModel/projectWorkflow.js (303 行)
//   createProjectWorkflowReadModel(ctx, helpers) 内部有 9 个小函数（共 121 行），
//   它们只依赖 ctx / helpers / 自身参数，可以提升成 makeHelpers({ctx, helpers}) 工厂。
//
// 判定（AST 作用域）：自由名 ⊆ {ctx, helpers} ∪ require 绑定 ∪ 全局 ∪ 自身参数 ∪ 其他被提升函数名。
// 核对：导出面一致 + 语法 + 可加载；不符自动回滚。delivery 侧有 golden 夹具兜底。

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
const REL = args[0];
const FN = args[1];
if (!REL || !FN) {
  console.error("用法: node scripts/dev/astinner.js <文件> <工厂函数名> [--apply]");
  process.exit(1);
}

const GLOBALS = new Set(["undefined", "NaN", "Infinity", "JSON", "Math", "Object", "Array", "String",
  "Number", "Boolean", "Date", "Set", "Map", "Promise", "RegExp", "Error", "TypeError", "Symbol",
  "parseInt", "parseFloat", "isNaN", "isFinite", "console", "process", "Buffer", "require", "module",
  "exports", "__dirname", "global", "structuredClone", "URL", "URLSearchParams", "fetch", "crypto",
  "arguments", "BigInt"]);

function walkChildren(node, cb) {
  for (const key of Object.keys(node)) {
    if (["type", "start", "end", "loc"].includes(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) for (const it of value) if (it && typeof it.type === "string") cb(it);
    else if (value && typeof value.type === "string") cb(value);
  }
}
function patternNames(node, out = new Set()) {
  if (!node) return out;
  switch (node.type) {
    case "Identifier": out.add(node.name); break;
    case "ObjectPattern": for (const p of node.properties) patternNames(p.type === "RestElement" ? p.argument : p.value, out); break;
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
      case "OptionalMemberExpression": visit(node.object); if (node.computed) visit(node.property); return;
      case "ObjectProperty":
      case "ClassProperty":
      case "ObjectMethod":
      case "ClassMethod":
        if (node.computed) visit(node.key);
        if (node.value) visit(node.value);
        if (node.type === "ObjectMethod") visit(node.body);
        return;
      case "VariableDeclarator": patternNames(node.id, declared); if (node.init) visit(node.init); return;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node.id) declared.add(node.id.name);
        for (const p of node.params) patternNames(p, declared);
        visit(node.body); return;
      case "ClassDeclaration":
      case "ClassExpression": if (node.id) declared.add(node.id.name); visit(node.body); return;
      case "CatchClause": patternNames(node.param, declared); visit(node.body); return;
      case "LabeledStatement": visit(node.body); return;
      case "BreakStatement": case "ContinueStatement": case "ImportDeclaration": return;
      default: walkChildren(node, visit);
    }
  }
  visit(subtree);
  for (const n of declared) referenced.delete(n);
  return referenced;
}

const full = path.join(ROOT, REL);
const src = fs.readFileSync(full, "utf8");
const ast = parser.parse(src, { sourceType: "script" });
const topFn = ast.program.body.find((n) => n.type === "FunctionDeclaration" && n.id.name === FN);
const params = new Set();
for (const p of topFn.params) patternNames(p, params);

// 收集：顶层小函数 + buildProject 内部的小函数
const candidates = [];
for (const stmt of topFn.body.body) {
  if (stmt.type === "FunctionDeclaration") candidates.push({ node: stmt, name: stmt.id.name });
  if (stmt.type === "FunctionDeclaration" && stmt.id.name === "buildProject") {
    for (const inner of stmt.body.body) {
      if (inner.type === "FunctionDeclaration") candidates.push({ node: inner, name: inner.id.name, nested: true });
    }
  }
}
const reqNames = new Set();
for (const n of ast.program.body) {
  if (n.type === "VariableDeclaration" && /require\(/.test(src.slice(n.start, n.end))) {
    for (const d of n.declarations) for (const nm of patternNames(d.id)) reqNames.add(nm);
  }
}

const allowed = new Set([...params, ...reqNames]);           // ctx / helpers / require 绑定
// 外层函数从 ctx / helpers 解构出来的名字（提升后由 _helpers 里的同样解构提供）
for (const stmt of topFn.body.body) {
  if (stmt.type !== "VariableDeclaration") continue;
  if (!/=\s*(ctx|helpers)\s*;?\s*$/.test(src.slice(stmt.start, stmt.end).trim())) continue;
  for (const d of stmt.declarations) for (const n of patternNames(d.id)) allowed.add(n);
}
// buildProject 体内的局部（含它的内部函数名）—— 嵌套候选若引用了它们，就要参数化
const buildProject = topFn.body.body.find((s) => s.type === "FunctionDeclaration" && s.id.name === "buildProject");
const enclosingLocals = new Set();
if (buildProject) {
  for (const stmt of buildProject.body.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id) enclosingLocals.add(stmt.id.name);
    if (stmt.type === "VariableDeclaration") for (const d of stmt.declarations) patternNames(d.id, enclosingLocals);
  }
}
const nestedNames = new Set(candidates.filter((c) => c.nested).map((c) => c.name));
for (const n of nestedNames) enclosingLocals.delete(n);

const hoistable = [];
const blocked = [];
// "容器"函数不提升：它自己包含其它候选（例如 buildProject 里就声明了
// statusDone/countByInstance/doneByInstance），提走它等于把整个工厂搬空
const containers = new Set();
for (const a of candidates) {
  for (const b of candidates) {
    if (a === b) continue;
    if (b.node.start > a.node.start && b.node.end < a.node.end) containers.add(a.name);
  }
}
for (const cand of candidates) {
  if (containers.has(cand.name)) {
    blocked.push({ name: cand.name, bad: ["包含其它候选函数（容器）"] });
    continue;
  }
  const free = [...freeNames(cand.node)];
  // 嵌套候选引用外层局部（如 id）时提升为入参，并在调用点补实参。
  // 这里对"外层局部"用**文本兜底**（AST 自由名分析在 `[id]` 这类数组实参上曾漏掉 id）：
  // 宁可多传一个用不到的参数，也不能漏 —— 漏了就是运行期 ReferenceError。
  const text = src.slice(cand.node.start, cand.node.end);
  cand.extraParams = cand.nested
    ? [...new Set([...free.filter((n) => enclosingLocals.has(n)),
                   ...[...enclosingLocals].filter((n) => new RegExp(`(?<![\\w$.])${n}(?![\\w$])`).test(text))])].sort()
    : [];
  const bad = free.filter(
    (n) => !allowed.has(n) && !GLOBALS.has(n) && !cand.extraParams.includes(n)
  );
  if (bad.length) blocked.push({ name: cand.name, bad });
  else hoistable.push(cand);
}

console.log(`${REL}`);
console.log(`  候选 ${candidates.length} 个；可提升 ${hoistable.length} 个（${hoistable.reduce((s, c) => s + src.slice(c.node.start, c.node.end).split("\n").length, 0)} 行）`);
console.log(`    ${hoistable.map((c) => c.name + (c.extraParams.length ? `(+${c.extraParams.join(",")})` : "")).join(", ")}`);
for (const b of blocked) console.log(`    提升不了 ${b.name}：依赖 ${b.bad.join(",")}`);
if (!APPLY || !hoistable.length) process.exit(0);

function shiftRequires(text) {
  return text.replace(/require\((['"])((?:\.\.\/|\.\/)*)([^'"]*)/g, (all, q, prefix, rest) => {
    if (!prefix) return all;
    return `require(${q}${prefix.startsWith("./") ? "../" : "../" + prefix}${rest}`;
  });
}
function snapshot(target) {
  try {
    return execFileSync("node", ["-e", `console.log(JSON.stringify(Object.keys(require('./${target}')).sort()))`],
      { cwd: ROOT, encoding: "utf8" }).trim();
  } catch (e) { return "LOAD_FAIL:" + String(e.message).slice(0, 150); }
}

const before = snapshot(REL.replace(/\.js$/, ""));
const outDir = path.join(path.dirname(full), path.basename(full, ".js"));
fs.mkdirSync(outDir, { recursive: true });

const names = hoistable.map((c) => c.name);
const extraOf = new Map(hoistable.map((c) => [c.name, c.extraParams || []]));
// 提升函数定义时，把 extraParams 前置为形参
function hoistedText(cand) {
  let text = src.slice(cand.node.start, cand.node.end);
  if (cand.extraParams.length) {
    const head = `${cand.name}(`;
    const at = text.indexOf(head) + head.length;
    text = text.slice(0, at) + cand.extraParams.join(", ") + (text[at] === ")" ? "" : ", ") + text.slice(at);
  }
  return text;
}
// 外层函数里从 ctx / helpers 解构出来的名字，提升后的函数仍要用 -> 复制进工厂体
const destructLines = [];
for (const stmt of topFn.body.body) {
  if (stmt.type !== "VariableDeclaration") continue;
  const text = src.slice(stmt.start, stmt.end);
  if (/=\s*(ctx|helpers)\s*;?\s*$/.test(text.trim())) destructLines.push(src.slice(stmt.start, stmt.end));
}
// 需要的 require（提升函数引用到、且不是 ctx/helpers 的）
const needReq = new Set();
for (const c of hoistable) for (const n of freeNames(c.node)) if (reqNames.has(n)) needReq.add(n);
const helperSrc =
  '"use strict";\n// 从 ' + REL + ' 提升出来的内部小函数（只依赖 ctx / helpers 与自身参数）\n\n' +
  [...needReq].map((n) => {
    const stmt = ast.program.body.find((x) => x.type === "VariableDeclaration" && /require\(/.test(src.slice(x.start, x.end)) && [...patternNames(x.declarations[0].id)].includes(n));
    return stmt ? shiftRequires(src.slice(stmt.start, stmt.end)) : "";
  }).filter(Boolean).join("\n") +
  "\n\nmodule.exports = function makeHelpers({ " + [...params].join(", ") + " }) {\n" +
  destructLines.map((l) => l.replace(/^ {2}/, "")).join("\n") + "\n\n" +
  hoistable.map(hoistedText).join("\n\n") +
  "\n\n  return { " + names.join(", ") + " };\n};\n";
fs.writeFileSync(path.join(outDir, "_helpers.js"), helperSrc);

// 主文件：删掉被提升的函数 + 给嵌套函数的调用点补上新增的实参
// （从后往前改，避免偏移错位）
const edits = [];
for (const c of hoistable) edits.push({ start: c.node.start, end: c.node.end, text: "" });
for (const c of hoistable) {
  if (!c.extraParams.length || !buildProject) continue;
  (function findCalls(node) {
    if (!node || typeof node.type !== "string") return;
    if (
      node.type === "CallExpression" &&
      node.callee && node.callee.type === "Identifier" && node.callee.name === c.name &&
      node.start >= buildProject.start && node.end <= buildProject.end
    ) {
      const at = node.arguments.length ? node.arguments[0].start : node.end - 1;
      edits.push({ start: at, end: at, text: c.extraParams.join(", ") + ", " });
    }
    walkChildren(node, findCalls);
  })(buildProject);
}
edits.sort((a, b) => b.start - a.start);
let out = src;
for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
out = shiftRequires(out);                       // 文件下沉一层，相对 require 要加深
const insertAfter = /^ *const \{[\s\S]*?\} = helpers;\n/m;
const m = out.match(insertAfter);
const header = 'const { ' + names.join(", ") + ' } = require("./_helpers")({ ' + [...params].join(", ") + ' });\n';
out = m
  ? out.slice(0, m.index + m[0].length) + header + out.slice(m.index + m[0].length)
  : out.replace(/^("use strict";\n)/, "$1" + header);
fs.writeFileSync(path.join(outDir, "index.js"), out);
fs.unlinkSync(full);

const after = snapshot(REL.replace(/\.js$/, ""));
let syntaxOk = true;
for (const f of fs.readdirSync(outDir)) {
  try { execFileSync("node", ["--check", path.join(outDir, f)], { encoding: "utf8" }); }
  catch (e) { syntaxOk = false; console.log("   语法失败", f, String(e.stderr || "").slice(0, 200)); }
}
if (before !== after || !syntaxOk) {
  console.log(`   ❌ 核对失败 before=${before} after=${after}`);
  execFileSync("git", ["checkout", "--", REL], { cwd: ROOT });
  fs.rmSync(outDir, { recursive: true, force: true });
} else {
  console.log(`   ✅ index.js ${out.split("\n").length} 行 + _helpers.js ${helperSrc.split("\n").length} 行；导出一致`);
}
