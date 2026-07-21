"use strict";

const { emit, Events } = require("../../app/ws/EventBus");

function createDocumentLifecycle(db) {
  return function archiveDocumentsForEco(ecoId, newState) {
    if (!["approved", "closed"].includes(newState)) return [];
    const documents = db.prepare("SELECT id, title, doc_code, status FROM documents WHERE eco_id = ? AND status = 'issued'").all(ecoId);
    const revoke = db.prepare("UPDATE documents SET status = 'revoked', revoke_reason = ?, revoked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?");
    for (const document of documents) {
      revoke.run(`ECO #${ecoId} 已审批, 文档需更新至新版本`, document.id);
      emit(Events.DOCUMENT_REVOKED, {
        id: document.id,
        doc_code: document.doc_code,
        title: document.title,
        reason: `ECO #${ecoId} 已审批, 旧版自动归档`,
        eco_id: ecoId,
      });
    }
    return documents;
  };
}

module.exports = { createDocumentLifecycle };
