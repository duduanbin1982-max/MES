"use strict";

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`invalid identifier: ${value}`);
  return `"${value}"`;
}

/**
 * 2026-11-02：收集依赖 process_nodes 的视图（含通过其它视图间接依赖的）。
 * 表重建（DROP + RENAME）期间 SQLite 会重新解析视图定义，若视图仍指向被删的表会报
 * "error in view ...: no such table"。因此重建前先按依赖顺序删除，重建后原样恢复。
 */
function collectDependentViews(db, tableName) {
  const views = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'view' AND sql IS NOT NULL ORDER BY rowid"
  ).all();
  const pattern = new RegExp(`\\b${tableName}\\b`, "i");
  const dependent = new Set(views.filter((view) => pattern.test(view.sql)).map((view) => view.name));
  let grew = true;
  while (grew) {
    grew = false;
    for (const view of views) {
      if (dependent.has(view.name)) continue;
      for (const name of dependent) {
        if (new RegExp(`\\b${name}\\b`).test(view.sql)) {
          dependent.add(view.name);
          grew = true;
          break;
        }
      }
    }
  }
  return views.filter((view) => dependent.has(view.name));
}

function repairProcessNodesBomForeignKey(db) {
  const foreignKeys = db.prepare("PRAGMA foreign_key_list(process_nodes)").all();
  const bomForeignKey = foreignKeys.find((foreignKey) => foreignKey.from === "bom_node_id");
  if (!bomForeignKey || bomForeignKey.table === "instance_bom") return false;

  const tableRecord = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'process_nodes'").get();
  if (!tableRecord?.sql) throw new Error("process_nodes schema is unavailable");
  const dependentObjects = db.prepare(`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE tbl_name = 'process_nodes'
      AND type IN ('index', 'trigger')
      AND sql IS NOT NULL
    ORDER BY type, name
  `).all();
  const columns = db.prepare("PRAGMA table_info(process_nodes)").all().map((column) => column.name);
  const columnList = columns.map(quoteIdentifier).join(", ");
  const replacementTable = "process_nodes_fk_repair";
  const replacementSql = tableRecord.sql
    .replace(/^CREATE TABLE\s+(?:"process_nodes"|process_nodes)/i, `CREATE TABLE ${quoteIdentifier(replacementTable)}`)
    .replace(/REFERENCES\s+(?:"process_nodes"|process_nodes)(?![A-Za-z0-9_])/gi, `REFERENCES ${quoteIdentifier(replacementTable)}`)
    .replace(/REFERENCES\s+(?:"instance_bom_v22"|instance_bom_v22)(?![A-Za-z0-9_])/gi, "REFERENCES instance_bom");

  const foreignKeysEnabled = db.pragma("foreign_keys", { simple: true }) === 1;
  if (foreignKeysEnabled) db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      // 依赖视图先删（逆创建序），重建后按创建序恢复
      const dependentViews = collectDependentViews(db, "process_nodes");
      for (const view of dependentViews.slice().reverse()) {
        db.exec(`DROP VIEW IF EXISTS ${quoteIdentifier(view.name)}`);
      }
      db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(replacementTable)}`);
      db.exec(replacementSql);
      db.exec(`INSERT INTO ${quoteIdentifier(replacementTable)} (${columnList}) SELECT ${columnList} FROM process_nodes`);
      db.exec("DROP TABLE process_nodes");
      db.exec(`ALTER TABLE ${quoteIdentifier(replacementTable)} RENAME TO process_nodes`);
      for (const object of dependentObjects) db.exec(object.sql);
      for (const view of dependentViews) db.exec(view.sql);
    }).immediate();
  } finally {
    if (foreignKeysEnabled) db.pragma("foreign_keys = ON");
  }
  return true;
}

module.exports = { repairProcessNodesBomForeignKey, collectDependentViews };
