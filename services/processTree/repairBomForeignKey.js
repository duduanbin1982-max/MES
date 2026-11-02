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

/**
 * 2026-11-02：收集引用了「待删视图」的触发器。
 * 只删视图不删触发器会出问题：重建过程的任何 DDL 都会触发 schema 重新解析，
 * 此时触发器引用的视图正处于"已删除"状态 → "error in trigger ...: no such table: main.v_xxx"。
 */
function collectTriggersReferencing(db, viewNames) {
  if (!viewNames.size) return [];
  const triggers = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL ORDER BY rowid"
  ).all();
  return triggers.filter((trigger) => [...viewNames].some((name) => new RegExp(`\\b${name}\\b`).test(trigger.sql)));
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

  const dependentViews = collectDependentViews(db, "process_nodes");
  const dependentViewNames = new Set(dependentViews.map((view) => view.name));
  // 表自带的触发器（tbl_name=process_nodes）会随 DROP TABLE 一起消失，并在 dependentObjects 里恢复；
  // 这里只补"挂在别的表上、但引用了待删视图"的触发器，避免重复创建。
  const rebuiltObjectNames = new Set(dependentObjects.filter((object) => object.type === "trigger").map((object) => object.name));
  const dependentTriggers = collectTriggersReferencing(db, dependentViewNames)
    .filter((trigger) => !rebuiltObjectNames.has(trigger.name));

  const foreignKeysEnabled = db.pragma("foreign_keys", { simple: true }) === 1;
  if (foreignKeysEnabled) db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      // 1) 先摘掉"引用了待删视图"的触发器（否则后续 DDL 的 schema 解析会失败）
      for (const trigger of dependentTriggers.slice().reverse()) {
        db.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(trigger.name)}`);
      }
      // 2) 再删依赖视图（逆创建序）
      for (const view of dependentViews.slice().reverse()) {
        db.exec(`DROP VIEW IF EXISTS ${quoteIdentifier(view.name)}`);
      }
      // 3) 重建表
      db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(replacementTable)}`);
      db.exec(replacementSql);
      db.exec(`INSERT INTO ${quoteIdentifier(replacementTable)} (${columnList}) SELECT ${columnList} FROM process_nodes`);
      db.exec("DROP TABLE process_nodes");
      db.exec(`ALTER TABLE ${quoteIdentifier(replacementTable)} RENAME TO process_nodes`);
      // 4) 视图先恢复（触发器可能引用视图），再恢复索引/触发器
      for (const view of dependentViews) db.exec(view.sql);
      for (const object of dependentObjects) db.exec(object.sql);
      for (const trigger of dependentTriggers) db.exec(trigger.sql);
    }).immediate();
  } finally {
    if (foreignKeysEnabled) db.pragma("foreign_keys = ON");
  }
  return true;
}

module.exports = { repairProcessNodesBomForeignKey, collectDependentViews, collectTriggersReferencing };
