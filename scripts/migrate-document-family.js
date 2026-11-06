"use strict";
// 2026-11-07（文档审计 D-6）：历史文档显式版本链回填
//   document_family_id：同一 doc_code（去版本后缀）取最早 id 作为 family
//   parent_document_id：同 family 内按 id 顺序指向前一条
// 用法：node scripts/migrate-document-family.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");
const { documentFamilyBase } = require("../services/documentService/history");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

function plan(db) {
  const docs = db.prepare("SELECT id, doc_code, document_family_id, parent_document_id FROM documents ORDER BY id").all();
  const groups = new Map();
  for (const doc of docs) {
    const key = doc.doc_code ? documentFamilyBase(doc.doc_code) || doc.doc_code : `DOC-${doc.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }
  const updates = [];
  for (const list of groups.values()) {
    const familyId = Math.min(...list.map((doc) => Number(doc.id)));
    let previousId = null;
    for (const doc of list) {
      const nextFamily = doc.document_family_id || familyId;
      const nextParent = doc.parent_document_id || previousId;
      if (nextFamily !== doc.document_family_id || (nextParent || null) !== (doc.parent_document_id || null)) {
        updates.push({ id: doc.id, family_id: nextFamily, parent_id: nextParent || null });
      }
      previousId = Number(doc.id);
    }
  }
  return { total: docs.length, updates };
}

function apply(db, planData) {
  const tx = db.transaction(() => {
    for (const update of planData.updates) {
      db.prepare("UPDATE documents SET document_family_id = ?, parent_document_id = ? WHERE id = ?").run(update.family_id, update.parent_id, update.id);
    }
  });
  tx();
  return planData.updates.length;
}

function main() {
  const applyMode = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const columns = new Set(db.prepare("PRAGMA table_info(documents)").all().map((column) => column.name));
    if (!columns.has("document_family_id")) db.exec("ALTER TABLE documents ADD COLUMN document_family_id INTEGER");
    if (!columns.has("parent_document_id")) db.exec("ALTER TABLE documents ADD COLUMN parent_document_id INTEGER");
    const planData = plan(db);
    console.log(`[document-family] 文档 ${planData.total} 条，待回填 ${planData.updates.length} 条`);
    if (applyMode) console.log(`✅ 回填 ${apply(db, planData)} 条`);
    else console.log("（未执行，加 --apply 生效）");
  } finally { db.close(); }
}
module.exports = { plan, apply };
if (require.main === module) main();
