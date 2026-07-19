"use strict";

const { wrap } = require("../../middleware/asyncHandler");

function registerCatalogRoutes({ app, helpers }) {
  const { all } = helpers;

  app.get("/api/materials", wrap((req, res) => {
    const { is_key_component, is_self_made } = req.query;
    let sql = "SELECT * FROM materials WHERE 1=1";
    if (is_key_component) sql += " AND is_key_component = 1";
    if (is_self_made) sql += " AND is_self_made = 1";
    sql += " ORDER BY material_code";
    res.json(all(sql));
  }));

  app.get("/api/key_components", wrap((_req, res) => {
    res.json(all("SELECT kc.*, m.material_name FROM key_components kc JOIN materials m ON kc.material_id = m.id ORDER BY kc.lead_time_weeks DESC"));
  }));

  app.get("/api/key_components/long_leadtime", wrap((_req, res) => {
    res.json(all("SELECT kc.*, m.material_name FROM key_components kc JOIN materials m ON kc.material_id = m.id WHERE kc.lead_time_weeks >= 12 ORDER BY kc.lead_time_weeks DESC"));
  }));
}

module.exports = { registerCatalogRoutes };
