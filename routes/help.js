"use strict";

const fs = require("fs");
const path = require("path");

const MANUAL_PATH = path.resolve(__dirname, "../docs/mes-business-operation-manual.md");

function register(app) {
  app.get("/api/help/manual", (_req, res, next) => {
    try {
      const stat = fs.statSync(MANUAL_PATH);
      const markdown = fs.readFileSync(MANUAL_PATH, "utf8");
      res.json({
        title: "TBM-MES 业务流程清查与操作手册",
        updated_at: stat.mtime.toISOString(),
        markdown,
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { register };
