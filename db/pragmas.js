"use strict";
// db/pragmas.js
// SQLite 性能/安全 pragma 配置
//   WAL          : 并发读写, 避免锁阻塞
//   foreign_keys : 默认 OFF, 显式开启 (否则 FK 约束形同虚设)
//   synchronous  : NORMAL (WAL 模式推荐)
//   cache/mmap   : 提升 TBM-MES 大表查询和 IoT 写入吞吐
// P1: apply 后立即 verify，防止“代码声明”和“实际连接状态”再次漂移。

const EXPECTED_PRAGMAS = Object.freeze({
  journal_mode: "wal",
  foreign_keys: 1,
  synchronous: 1,
  cache_size: -64000,
  mmap_size: 268435456,
});

function readPragmas(db) {
  return {
    journal_mode: String(db.pragma("journal_mode", { simple: true })).toLowerCase(),
    foreign_keys: Number(db.pragma("foreign_keys", { simple: true })),
    synchronous: Number(db.pragma("synchronous", { simple: true })),
    cache_size: Number(db.pragma("cache_size", { simple: true })),
    mmap_size: Number(db.pragma("mmap_size", { simple: true })),
  };
}

function verifyPragmas(db, expected = EXPECTED_PRAGMAS) {
  const actual = readPragmas(db);
  const issues = [];

  for (const [key, expectedValue] of Object.entries(expected)) {
    if (actual[key] !== expectedValue) {
      issues.push({ key, expected: expectedValue, actual: actual[key] });
    }
  }

  return { ok: issues.length === 0, actual, issues };
}

function applyPragmas(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000");      // ~64MB cache
  db.pragma("mmap_size = 268435456");    // 256MB memory-mapped I/O
  db.pragma("temp_store = MEMORY");      // temp tables in memory
  db.pragma("busy_timeout = 5000");      // 5s busy wait

  const status = verifyPragmas(db);
  if (!status.ok) {
    const msg = "[db] PRAGMA verification failed: " + JSON.stringify(status.issues);
    if (process.env.DB_STRICT_PRAGMAS === "1") {
      throw new Error(msg);
    }
    console.warn(msg);
  }
  return status;
}

module.exports = applyPragmas;
module.exports.EXPECTED_PRAGMAS = EXPECTED_PRAGMAS;
module.exports.readPragmas = readPragmas;
module.exports.verifyPragmas = verifyPragmas;
