"use strict";

const meta = require("./documentService/meta");
const storage = require("./documentService/storage");
const history = require("./documentService/history");
const { ensureDocumentSchema } = require("./documentService/schema");
const { registerCollectionRoutes, registerDetailRoutes } = require("./documentService/queryRoutes");
const { registerAcknowledgementRoutes } = require("./documentService/acknowledgementRoutes");
const { registerMutationRoutes } = require("./documentService/mutationRoutes");
const { registerCollectionRoutes: registerControlCollectionRoutes, registerControlRoutes } = require("./documentService/control");

function register(app, db) {
  ensureDocumentSchema(db);
  registerControlCollectionRoutes(app, db);
  registerCollectionRoutes(app, db);
  registerAcknowledgementRoutes(app, db);
  registerControlRoutes(app, db);
  registerDetailRoutes(app, db);
  registerMutationRoutes(app, db);
}

module.exports = {
  register,
  ...meta,
  ...storage,
  ...history,
};
