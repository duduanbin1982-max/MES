/**
 * utils/partNo.js 单测 (brooks-lint R1 Suggestion 修复)
 *
 * 目的：覆盖 generate() 的 5 种零件类型分支 (fabricated/purchased/imported/outsourced/standard)
 *       与 nextSequence() 的计数逻辑.
 *
 * 用法: node tests/utils-partno.test.js
 *
 * 注入 in-memory DB 策略:
 *   utils/partNo.js 顶层 const db = require('../db') 实际解析到 db/index.js (Node 默认解析).
 *   测试前用 require.resolve('../db') 拿到解析路径, 然后把 require.cache[resolvedPath]
 *   替换成一个 in-memory better-sqlite3 实例, 后续 partNo.js 加载时就会拿到这个替换.
 *
 * 这样既不需要 db.js 兼容垫片, 也不需要改 partNo.js 代码.
 */

const path = require('path');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

let passed = 0, failed = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (ok) { console.log('  ✅', label, '→', got); passed++; }
  else { console.log('  ❌', label, '\n     got:', JSON.stringify(got), '\n     want:', JSON.stringify(want)); failed++; }
};

// 准备 in-memory DB (有 parts 表, 满足 partNo.js 的 nextSequence 查询)
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

// 关键修复: 用 require.resolve('../db') 拿到 Node 实际会解析的路径 (即 db/index.js)
// 而不是 'db.js' (那是旧垫片, 已删除).
// 这样 partNo.js 顶层 require('../db') 才会拿到 in-memory DB.
const dbResolvedPath = require.resolve('../db');
console.log('  ℹ️  解析到的 db 模块路径:', dbResolvedPath);

// 在 partNo.js 加载之前, 把 db 模块的 require.cache 项替换为 in-memory 实例
require.cache[dbResolvedPath] = {
  id: dbResolvedPath,
  filename: dbResolvedPath,
  loaded: true,
  exports: makeDb(),
};

// 加载 partNo.js (会触发顶层 const db = require('../db'), 命中上面塞的 cache)
const partNo = require('../utils/partNo.js');

eq('exports generate', typeof partNo.generate, 'function');

// === generate() 各分支测试 ===
console.log('\n=== generate() 分支覆盖 ===');
{
  // 1) 自制件 (fabricated): TBM-2026-001-MS001-P001-01
  const out = partNo.generate(1, 'TBM-2026-001', 'MS001', 'P001', 'fabricated');
  eq('fabricated: projectCode-MSCode-drawingNo-seq', out, 'TBM-2026-001-MS001-P001-01');

  // 2) 外购件 (purchased): TBM-2026-001-OUT-SKF-001
  const out2 = partNo.generate(1, 'TBM-2026-001', null, 'SKF', 'purchased');
  eq('purchased: projectCode-OUT-supplier-seq', out2, 'TBM-2026-001-OUT-SKF-001');

  // 3) 进口件 (imported): TBM-2026-001-IMP-X-001
  const out3 = partNo.generate(1, 'TBM-2026-001', null, 'X', 'imported');
  eq('imported: projectCode-IMP-supplier-seq', out3, 'TBM-2026-001-IMP-X-001');

  // 4) 外协件 (outsourced): TBM-2026-001-SUB-X-001
  const out4 = partNo.generate(1, 'TBM-2026-001', null, 'X', 'outsourced');
  eq('outsourced: projectCode-SUB-supplier-seq', out4, 'TBM-2026-001-SUB-X-001');

  // 5) 标准件 (standard): TBM-2026-001-STD-M16-001
  const out5 = partNo.generate(1, 'TBM-2026-001', null, 'M16', 'standard');
  eq('standard: projectCode-STD-spec-seq', out5, 'TBM-2026-001-STD-M16-001');

  // 6) 默认 (缺省 type): fallback 到 fabricated
  const out6 = partNo.generate(1, 'TBM-2026-001', 'MS001', 'P001');
  eq('default no type: fallback to fabricated', out6, 'TBM-2026-001-MS001-P001-01');

  // 7) mainStructureCode 缺省: 用 ROOT 兜底
  const out7 = partNo.generate(1, 'TBM-2026-001', null, 'P001', 'fabricated');
  eq('fabricated with null MS code: ROOT fallback', out7, 'TBM-2026-001-ROOT-P001-01');
}

console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===`);
console.log('# pass ' + passed);
console.log('# fail ' + failed);
process.exit(failed > 0 ? 1 : 0);