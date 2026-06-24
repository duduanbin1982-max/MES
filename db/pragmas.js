"use strict";
// db/pragmas.js
// SQLite 性能/安全 pragma 配置
//   WAL         : 并发读写, 避免锁阻塞
//   foreign_keys: 默认 OFF, 显式开启 (否则 FK 约束形同虚设)
//   synchronous : NORMAL (WAL 模式推荐, 比 FULL 快 ~10x, 数据安全级别相当)
// Author: 三狗子 | Date: 2026-06-24

function applyPragmas(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
}

module.exports = applyPragmas;