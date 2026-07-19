"use strict";

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`invalid identifier: ${value}`);
  return `"${value}"`;
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
      db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(replacementTable)}`);
      db.exec(replacementSql);
      db.exec(`INSERT INTO ${quoteIdentifier(replacementTable)} (${columnList}) SELECT ${columnList} FROM process_nodes`);
      db.exec("DROP TABLE process_nodes");
      db.exec(`ALTER TABLE ${quoteIdentifier(replacementTable)} RENAME TO process_nodes`);
      for (const object of dependentObjects) db.exec(object.sql);
    }).immediate();
  } finally {
    if (foreignKeysEnabled) db.pragma("foreign_keys = ON");
  }
  return true;
}

module.exports = { repairProcessNodesBomForeignKey };
