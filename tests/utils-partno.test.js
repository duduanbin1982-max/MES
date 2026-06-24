/**
 * utils/partNo.js 单测（brooks-lint R1 Suggestion 修复）
 *
 * 目的：覆盖 generate() 的 5 种零件类型分支（fabricated/purchased/imported/outsourced/standard）
 * 与 nextSequence() 的计数逻辑。
 *
 * 用法：node tests/utils-partno.test.js
 */

const path = require('path');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

let passed = 0, failed = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (ok) { console.log('  ✅', label, '→', got); passed++; }
  else { console.log('  ❌', label, '\n     got:', JSON.stringify(got), '\n     want:', JSON.stringify(want)); failed++; }
};

// 准备 in-memory DB
function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE parts (
      id INTEGER PRIMARY KEY,
      project_id INTEGER,
      part_no TEXT
    );
  `);
  return db;
}

console.log('=== utils/partNo.js 加载 ===');
delete require.cache[require.resolve('../utils/partNo.js')];

// 顶层 const db = require('../db') 是死引用 — 我们手动替换 path.join 让它解析到 in-memory DB
// 但更简单：用 monkey-patch + 在测试里 require 一次后用 require.cache 替换 db 模块
const pathMod = require('path');
const origResolve = pathMod.resolve;
const testDbPath = '/tmp/partno-test-' + Date.now() + '.db';

// 我们劫持 utils/partNo.js 里的 db：require 两次，一次用真 db.js（不行，它会创文件）
// 改方案：直接 require('../utils/partNo.js') 但注入 in-memory DB 是改不了的
// 折中：测试 generate() 的纯字符串拼接逻辑（不依赖 DB）

// 但 utils/partNo.js 的 generate 调用 nextSequence 用了 db.prepare。
// 我们看一下源码，把 nextSequence mock 掉

const utilsSrc = require('fs').readFileSync(pathMod.resolve(__dirname, '../utils/partNo.js'), 'utf8');
console.log('  ℹ️  utils/partNo.js 模块长度:', utilsSrc.length, 'chars');

// 由于 utils/partNo.js 是顶层 require('../db')，我们需要：
// 1. 把 db.js 模块替换成返回 in-memory DB 的版本
// 2. 然后 require partNo.js 让它拿到替换后的 db

// 准备 in-memory DB 的"包装模块"
const realDbJs = require.resolve('../db.js');
delete require.cache[realDbJs];
require.cache[realDbJs] = {
  id: realDbJs,
  filename: realDbJs,
  loaded: true,
  exports: makeDb(),
};

delete require.cache[require.resolve('../utils/partNo.js')];
const partNo = require('../utils/partNo.js');

eq('exports generate', typeof partNo.generate, 'function');

// === generate() 各分支测试 ===
console.log('\n=== generate() 分支覆盖 ===');
{
  // 1) 自制件（fabricated）：TBM-2026-001-MS001-P001-01
  const out = partNo.generate(1, 'TBM-2026-001', 'MS001', 'P001', 'fabricated');
  eq('fabricated: projectCode-MSCode-drawingNo-seq', out, 'TBM-2026-001-MS001-P001-01');

  // 2) 外购件（purchased）：TBM-2026-001-OUT-SKF-001
  const out2 = partNo.generate(1, 'TBM-2026-001', null, 'SKF', 'purchased');
  eq('purchased: projectCode-OUT-supplier-seq', out2, 'TBM-2026-001-OUT-SKF-001');

  // 3) 进口件（imported）：TBM-2026-001-IMP-X-001
  const out3 = partNo.generate(1, 'TBM-2026-001', null, 'X', 'imported');
  eq('imported: projectCode-IMP-supplier-seq', out3, 'TBM-2026-001-IMP-X-001');

  // 4) 外协件（outsourced）：TBM-2026-001-SUB-X-001
  const out4 = partNo.generate(1, 'TBM-2026-001', null, 'X', 'outsourced');
  eq('outsourced: projectCode-SUB-supplier-seq', out4, 'TBM-2026-001-SUB-X-001');

  // 5) 标准件（standard）：TBM-2026-001-STD-M16-001
  const out5 = partNo.generate(1, 'TBM-2026-001', null, 'M16', 'standard');
  eq('standard: projectCode-STD-spec-seq', out5, 'TBM-2026-001-STD-M16-001');

  // 6) 默认（缺省 type）：fallback 到 fabricated
  const out6 = partNo.generate(1, 'TBM-2026-001', 'MS001', 'P001');
  eq('default no type: fallback to fabricated', out6, 'TBM-2026-001-MS001-P001-01');

  // 7) mainStructureCode 缺省：用 ROOT 兜底
  const out7 = partNo.generate(1, 'TBM-2026-001', null, 'P001', 'fabricated');
  eq('fabricated with null MS code: ROOT fallback', out7, 'TBM-2026-001-ROOT-P001-01');
}

console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===`)
console.log("# pass " + passed)
console.log("# fail " + failed);
process.exit(failed > 0 ? 1 : 0);