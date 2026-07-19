"use strict";

const { wrap } = require("../../middleware/asyncHandler");
const { createDbAccess } = require("./utils");

function registerOverviewRoutes(app, db) {
  const { get } = createDbAccess(db);
  app.get("/api/process-master/overview", wrap((_request, response) => {
    const position = get("SELECT COUNT(*) total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) active FROM process_positions");
    const operation = get("SELECT COUNT(*) total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) active FROM process_operation_templates");
    const processNode = get(`
      SELECT COUNT(*) total,
             SUM(CASE WHEN operation_template_id IS NOT NULL THEN 1 ELSE 0 END) templated,
             SUM(CASE WHEN required_position_code IS NOT NULL AND required_position_code != '' THEN 1 ELSE 0 END) positioned,
             SUM(CASE WHEN COALESCE(worker_count, 0) > 0 THEN 1 ELSE 0 END) staffed
      FROM process_nodes
    `);
    response.json({ positions: position, operations: operation, process_nodes: processNode });
  }));
}

module.exports = { registerOverviewRoutes };
