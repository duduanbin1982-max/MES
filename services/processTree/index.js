"use strict";

const { repairProcessNodesBomForeignKey } = require("./repairBomForeignKey");

function register(_app, db) {
  repairProcessNodesBomForeignKey(db);
  db.exec("CREATE INDEX IF NOT EXISTS idx_pn_bom ON process_nodes(bom_node_id)");
}

module.exports = { register, repairProcessNodesBomForeignKey };
