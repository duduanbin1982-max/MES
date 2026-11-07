"use strict";

const meta = require("./documentService/meta");
const storage = require("./documentService/storage");
const history = require("./documentService/history");
const { ensureDocumentSchema } = require("./documentService/schema");
const { registerCollectionRoutes, registerDetailRoutes } = require("./documentService/queryRoutes");
const { registerAcknowledgementRoutes } = require("./documentService/acknowledgementRoutes");
const { registerMutationRoutes } = require("./documentService/mutationRoutes");
const { registerCollectionRoutes: registerControlCollectionRoutes, registerControlRoutes } = require("./documentService/control");
const p1 = require("./documentService/p1");
const enterprise = require("./documentService/enterprise");

function register(app, db) {
  ensureDocumentSchema(db);
  registerControlCollectionRoutes(app, db);
  p1.registerCollectionRoutes(app, db);
  enterprise.registerCollectionRoutes(app, db);
  registerCollectionRoutes(app, db);
  registerAcknowledgementRoutes(app, db);
  registerControlRoutes(app, db);
  p1.registerControlRoutes(app, db);
  enterprise.registerControlRoutes(app, db);
  registerDetailRoutes(app, db);
  registerMutationRoutes(app, db);
}

module.exports = {
  register,
  ...meta,
  ...storage,
  ...history,
};
