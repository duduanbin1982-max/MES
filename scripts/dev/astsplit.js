#!/usr/bin/env node
"use strict";
// 开发期工具（不参与运行时）。用法见 scripts/dev/README.md。
// .tmp/astsplit.js —— 基于 AST 的 register 闭包拆分器（替代 routesplit.py 的正则方案）
//
// 为什么换成 AST：正则在"路由里的多行 SQL + 嵌套模板 + 单引号转义"上会失步，
// 把 SQL 列名当成自由变量（purchase/suppliers.js 就是这么卡住的）。
// acorn 已经在仓库里（Vite 依赖），直接按绝对路径引用。
//
// 做四件事：
//   1) acorn 解析 -> 找到 function register(app, db) 的语句列表
//   2) 其中 callee 是 app.<method> 的 ExpressionStatement = 路由语句；其余 = prelude
//   3) 对每条路由做**作用域分析**求自由变量（这才是 AST 的价值：不再靠关键字白名单）
//   4) 自由变量按来源归类：prelude 绑定 -> ctx；文件顶层声明 -> deps；require -> 复制 require
//
// 输出：<dir>/<stem>/{context.js, routes_N.js, index.js}，原文件删除。
// 核对：导出面一致 + node --check + 可加载；不一致自动 git 回滚。

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
// 仓库里没有独立的 acorn（Vite 7 走 rolldown 了），但有 @babel/parser（Vite 的依赖）

const FILES = args;

// 运行时内置全局：AST 版只需要这一份"真全局"名单就够了 ——
// 不再像正则版那样还要猜保留字（正是把 get/set 当保留字才踩了坑）。
const GLOBALS = new Set([
  "undefined", "NaN", "Infinity", "globalThis", "eval",
  "JSON", "Math", "Object", "Array", "String", "Number", "Boolean", "Date", "Set", "Map",
  "WeakMap", "WeakSet", "Promise", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError",
  "ReferenceError", "EvalError", "URIError", "Symbol", "BigInt", "Function", "Proxy", "Reflect",
  "Intl", "Atomics", "ArrayBuffer", "SharedArrayBuffer", "DataView",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array",
  "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI", "encodeURIComponent",
  "decodeURI", "decodeURIComponent", "escape", "unescape",
  "console", "process", "Buffer", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "setImmediate", "clearImmediate", "queueMicrotask", "structuredClone",
  "require", "module", "exports", "__dirname", "__filename", "global",
  "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "fetch", "AbortController", "AbortSignal",
  "crypto", "performance", "atob", "btoa", "arguments",
]);

// ---------------------------------------------------------------- AST 工具

function walkChildren(node, callback) {
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item.type === "string") callback(item, key);
    } else if (value && typeof value.type === "string") {
      callback(value, key);
    }
  }
}

function patternNames(node, out) {
  if (!node) return out;
  switch (node.type) {
    case "Identifier": out.add(node.name); break;
    case "ObjectPattern":
      for (const prop of node.properties) {
        if (prop.type === "RestElement") patternNames(prop.argument, out);
        else patternNames(prop.value, out);
      }
      break;
    case "ArrayPattern":
      for (const el of node.elements) patternNames(el, out);
      break;
    case "AssignmentPattern": patternNames(node.left, out); break;
    case "RestElement": patternNames(node.argument, out); break;
    default: break;
  }
  return out;
}

/**
 * 求子树里"被引用但未在子树内声明"的名字 —— AST 版，不再依赖关键字/正则。
 */
function freeNames(subtree) {
  const declared = new Set();
  const referenced = new Set();

  function visit(node, parent, key) {
    if (!node || typeof node.type !== "string") return;
    switch (node.type) {
      case "Identifier":
        referenced.add(node.name);
        return;
      case "MemberExpression":
        visit(node.object, node, "object");
        if (node.computed) visit(node.property, node, "property"); // obj.col 的 col 不是变量
        return;
      case "Property":
      case "ObjectProperty":
      case "ClassProperty":
      case "ObjectMethod":
      case "ClassMethod":
      case "ClassPrivateProperty":
        // { a: 1 } 的 a 是字面 key；{ a } 简写时 value 才是引用
        if (node.computed) visit(node.key, node, "key");
        if (node.value) visit(node.value, node, "value");
        if (node.type === "ObjectMethod") visit(node.body, node, "body");
        return;
      case "MemberExpression":
      case "OptionalMemberExpression":
        visit(node.object, node, "object");
        if (node.computed) visit(node.property, node, "property"); // obj.col 的 col 不是变量
        return;
      case "VariableDeclarator":
        patternNames(node.id, declared);
        if (node.init) visit(node.init, node, "init");
        return;
      case "FunctionDeclaration":
        if (node.id) declared.add(node.id.name);
        for (const p of node.params) patternNames(p, declared);
        visit(node.body, node, "body");
        return;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node.id) declared.add(node.id.name);
        for (const p of node.params) patternNames(p, declared);
        visit(node.body, node, "body");
        return;
      case "ClassDeclaration":
      case "ClassExpression":
        if (node.id) declared.add(node.id.name);
        visit(node.body, node, "body");
        return;
      case "CatchClause":
        patternNames(node.param, declared);
        visit(node.body, node, "body");
        return;
      case "LabeledStatement":
        visit(node.body, node, "body");
        return;
      case "BreakStatement":
      case "ContinueStatement":
        return;
      case "ImportDeclaration":
        return;
      default:
        walkChildren(node, (child, childKey) => visit(child, node, childKey));
    }
  }

  visit(subtree, null, null);
  for (const name of declared) referenced.delete(name);
  return referenced;
}

// ---------------------------------------------------------------- 解析入口

function parseSource(src) {
  return parser.parse(src, { sourceType: "script", allowReturnOutsideFunction: true, errorRecovery: true });
}

function findRegister(ast) {
  for (const node of ast.program.body) {
    if (node.type === "FunctionDeclaration" && node.id && node.id.name === "register") return node;
  }
  for (const node of ast.program.body) {
    if (node.type === "FunctionDeclaration" && node.id && /register/i.test(node.id.name)) return node;
  }
  return null;
}

function isRouteStatement(stmt, bodySrc) {
  if (stmt.type !== "ExpressionStatement") return false;
  const expr = stmt.expression;
  if (!expr || expr.type !== "CallExpression") return false;
  const callee = expr.callee;
  if (!callee || callee.type !== "MemberExpression" || callee.computed) return false;
  if (!callee.object || callee.object.type !== "Identifier" || callee.object.name !== "app") return false;
  const method = callee.property && callee.property.name;
  return ["get", "post", "put", "patch", "delete", "all", "use"].includes(method);
}

function topLevelDeclarations(ast, src) {
  const names = new Map(); // name -> 语句源码
  for (const node of ast.program.body) {
    if (node.type === "FunctionDeclaration" && node.id) {
      names.set(node.id.name, src.slice(node.start, node.end));
    } else if (node.type === "VariableDeclaration") {
      for (const d of node.declarations) {
        const set = patternNames(d.id, new Set());
        for (const n of set) names.set(n, src.slice(node.start, node.end));
      }
    }
  }
  return names;
}

function requireBindings(ast, src) {
  // { 名字 -> require 语句源码 }（简单 require 与解构 require 都覆盖）
  const map = new Map();
  for (const node of ast.program.body) {
    if (node.type !== "VariableDeclaration") continue;
    const stmtText = src.slice(node.start, node.end);
    if (!/require\(/.test(stmtText)) continue;
    for (const d of node.declarations) {
      const set = patternNames(d.id, new Set());
      for (const n of set) map.set(n, stmtText);
    }
  }
  return map;
}

// ---------------------------------------------------------------- 搬运与生成

function shiftRequires(text) {
  return text.replace(/require\((['"])((?:\.\.\/|\.\/)*)([^'"]*)/g, (all, quote, prefix, rest) => {
    if (!prefix) return all;
    const next = prefix.startsWith("./") ? "../" : "../" + prefix;
    return `require(${quote}${next}${rest}`;
  });
}

function snapshotTarget(target) {
  try {
    const keys = execFileSync("node", ["-e", `console.log(JSON.stringify(Object.keys(require('./${target}')).sort()))`],
      { cwd: ROOT, encoding: "utf8" }).trim();
    return keys;
  } catch (error) {
    return "LOAD_FAIL:" + String(error.message).slice(0, 200);
  }
}

function splitFile(rel) {
  const full = path.join(ROOT, rel);
  const src = fs.readFileSync(full, "utf8");
  const ast = parseSource(src);
  const register = findRegister(ast);
  if (!register) return { rel, skip: "找不到 function register(...)" };

  const body = register.body.body;
  const routes = body.filter((s) => isRouteStatement(s, src));
  if (!routes.length) return { rel, skip: "register 里没有路由" };

  const preludeNodes = body.filter((s) => !routes.includes(s));
  const prelude = preludeNodes
    .map((s) => src.slice(s.start, s.end))
    .join("\n");
  const preludeBindings = new Set();
  for (const node of preludeNodes) {
    if (node.type === "FunctionDeclaration" && node.id) preludeBindings.add(node.id.name);
    if (node.type === "VariableDeclaration") {
      for (const d of node.declarations) patternNames(d.id, preludeBindings);
    }
    if (node.type === "ClassDeclaration" && node.id) preludeBindings.add(node.id.name);
  }

  const moduleDecls = topLevelDeclarations(ast, src);
  const requires = requireBindings(ast, src);

  // 分组：按 URL 段，单组不超过 150 行
  const groups = [];
  let current = [];
  let currentLines = 0;
  for (const route of routes) {
    const text = src.slice(route.start, route.end);
    const urlMatch = text.match(/["'`]([^"'`]+)["'`]/);
    const segment = urlMatch ? urlMatch[1].split("/")[2] || "misc" : "misc";
    const lines = text.split("\n").length;
    if (current.length && (segment !== current.segment || currentLines + lines > 150)) {
      groups.push(current);
      current = [];
      currentLines = 0;
    }
    if (!current.length) current.segment = segment;
    current.push({ route, text });
    currentLines += lines;
  }
  if (current.length) groups.push(current);
  if (groups.length < 2 && routes.length >= 4) {
    const half = Math.ceil(routes.length / 2);
    groups.length = 0;
    groups.push(routes.slice(0, half).map((route) => ({ route, text: src.slice(route.start, route.end) })));
    groups.push(routes.slice(half).map((route) => ({ route, text: src.slice(route.start, route.end) })));
  }
  if (groups.length < 2) return { rel, skip: "只能聚成 1 组" };

  // 每条路由的自由变量归类
  const plan = [];
  const depsNeeded = new Set();
  for (const [index, group] of groups.entries()) {
    const needCtx = new Set();
    const needReq = new Set();
    const needDeps = new Set();
    for (const { route } of group) {
      const free = freeNames(route);
      if ([...free].some((name) => name == null)) {
        return { rel, skip: `内部错误: 自由名里出现 null/undefined；${JSON.stringify([...free].slice(0, 10))} @ ${src.slice(route.start, route.start + 60).split("\n")[0]}` };
      }
      for (const name of free) {
        if (GLOBALS.has(name) || ["app", "db", "req", "res", "next"].includes(name)) continue;
        if (preludeBindings.has(name)) needCtx.add(name);
        else if (requires.has(name)) needReq.add(name);
        else if (moduleDecls.has(name)) { depsNeeded.add(name); needDeps.add(name); }
        else {
          return { rel, skip: `路由组 ${index + 1} 有无法归类的自由名: ${name}` };
        }
      }
    }
    plan.push({ group, needCtx, needReq, needDeps });
  }

  const sizes = plan.map((p) => p.group.reduce((sum, g) => sum + g.text.split("\n").length, 0));
  const info = { rel, groups: plan.length, sizes, preludeLines: prelude.split("\n").length,
                 deps: [...depsNeeded].sort(), ctx: [...preludeBindings].sort() };
  if (!APPLY) return info;

  const before = snapshotTarget(rel.replace(/\.js$/, ""));
  const baseDir = path.dirname(full);
  const stem = path.basename(full, ".js");
  const outDir = path.join(baseDir, stem);
  fs.mkdirSync(outDir, { recursive: true });

  // context.js
  // context.js：prelude 自己引用到的 require 也要复制进来
  // （例如 const { all, get, run } = makeHelpers(db) 里的 makeHelpers）
  const preludeFree = new Set();
  for (const node of preludeNodes) {
    for (const name of freeNames(node)) preludeFree.add(name);
  }
  const ctxReqLines = [];
  for (const name of preludeFree) {
    if (!requires.has(name)) continue;
    const stmt = shiftRequires(requires.get(name));
    if (!ctxReqLines.includes(stmt)) ctxReqLines.push(stmt);
  }
  const depsDecl = depsNeeded.size ? `  const { ${[...depsNeeded].sort().join(", ")} } = deps;\n` : "";
  const ctxReturn = `  return { ${[...preludeBindings, ...depsNeeded].sort().join(", ")} };`;
  fs.writeFileSync(path.join(outDir, "context.js"),
    '"use strict";\n// ' + rel + ' 的 register() 前置逻辑（AST 版拆分）\n\n' +
    (ctxReqLines.length ? ctxReqLines.join("\n") + "\n\n" : "") +
    "module.exports = function createContext(app, db, deps) {\n" +
    depsDecl + shiftRequires(prelude).trimEnd() + "\n\n" + ctxReturn + "\n};\n");

  // routes_N.js
  plan.forEach(({ group, needCtx, needReq, needDeps }, index) => {
    const lines = [];
    for (const name of [...needReq].sort()) {
      const stmt = shiftRequires(requires.get(name));
      if (!lines.includes(stmt)) lines.push(stmt);
    }
    const fromCtx = [...new Set([...needCtx, ...needDeps])].sort();
    if (fromCtx.length) lines.push(`const { ${fromCtx.join(", ")} } = ctx;`);
    const text = group.map((g) => shiftRequires(g.text)).join("\n\n");
    fs.writeFileSync(path.join(outDir, `routes_${index + 1}.js`),
      `"use strict";\n// ${rel} 的路由组 ${index + 1}（AST 版拆分）\n\n` +
      `module.exports = function registerRoutes${index + 1}(app, db, ctx) {\n` +
      lines.join("\n") + "\n\n" + text + "\n};\n");
  });

  // index.js
  const registerHead = src.slice(0, register.body.start + 1);   // 含 '{'
  const registerTail = src.slice(register.body.end - 1);        // 含 '}'
  const newBody = [];
  if (prelude.trim()) {
    newBody.push(depsNeeded.size
      ? `  const ctx = createContext(app, db, { ${[...depsNeeded].sort().join(", ")} });`
      : "  const ctx = createContext(app, db);");
  }
  plan.forEach((_, index) => newBody.push(`  registerRoutes${index + 1}(app, db, ctx);`));
  let indexSrc = shiftRequires(registerHead) + "\n" + newBody.join("\n") + "\n" + shiftRequires(registerTail);
  const header = [];
  if (prelude.trim()) header.push('const createContext = require("./context");');
  plan.forEach((_, i) => header.push(`const registerRoutes${i + 1} = require("./routes_${i + 1}");`));

  const decls = [...indexSrc.matchAll(/^(?:const|let|var)[^\n]*require\([^\n]*\);\s*$/gm)];
  const insertAt = decls.length ? decls[decls.length - 1].index + decls[decls.length - 1][0].length : 0;
  indexSrc = indexSrc.slice(0, insertAt) + "\n" + header.join("\n") + "\n" + indexSrc.slice(insertAt);
  fs.writeFileSync(path.join(outDir, "index.js"), indexSrc);
  fs.unlinkSync(full);

  const after = snapshotTarget(rel.replace(/\.js$/, ""));
  let syntaxOk = true;
  for (const f of fs.readdirSync(outDir)) {
    try {
      execFileSync("node", ["--check", path.join(outDir, f)], { encoding: "utf8" });
    } catch (error) {
      syntaxOk = false;
      info.syntaxError = f + ": " + String(error.stderr || error.message).slice(0, 200);
    }
  }
  if (before !== after || !syntaxOk) {
    execFileSync("git", ["checkout", "--", rel], { cwd: ROOT });
    fs.rmSync(outDir, { recursive: true, force: true });
    return { rel, failed: true, before, after, syntaxOk, syntaxError: info.syntaxError };
  }
  info.ok = true;
  info.indexLines = indexSrc.split("\n").length;
  return info;
}

for (const rel of FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    console.log(`${rel}  跳过：已拆分`);
    continue;
  }
  const result = splitFile(rel);
  if (result.skip) console.log(`${rel}  放弃（${result.skip}）`);
  else if (result.failed) console.log(`${rel}  ❌ 核对失败 before=${result.before} after=${result.after} syntax=${result.syntaxError || ""}`);
  else console.log(`${rel}  ✅ prelude ${result.preludeLines} 行 + ${result.groups} 组 ${JSON.stringify(result.sizes)}` +
    (result.ok ? `  index ${result.indexLines} 行  deps=[${result.deps.join(",")}]` : ""));
}
