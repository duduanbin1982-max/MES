"use strict";

const fs = require("fs");
const path = require("path");
const { requirePermission } = require('../middleware/auth');

const MANUAL_PATH = path.resolve(__dirname, "../docs/mes-business-operation-manual.md");

function register(app) {
  // P0-2 brooks-lint: help/manual 含敏感操作信息, 加 requirePermission('help:read')
  app.get("/api/help/manual", requirePermission('help:read'), (_req, res, next) => {
    try {
      const stat = fs.statSync(MANUAL_PATH);
      const markdown = fs.readFileSync(MANUAL_PATH, "utf8");
      res.json({
        title: "TBM-MES 操作手册",
        updated_at: stat.mtime.toISOString(),
        markdown,
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { register };
