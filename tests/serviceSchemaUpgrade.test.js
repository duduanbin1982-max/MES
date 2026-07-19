"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "service-schema-upgrade-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const express = require("express");
const { makeDbHelpers } = require("../app/dbHelpers");
const { ApiError } = require("../app/errors");
const instanceRoutes = require("../routes/instance");
const { createCodeGenerator } = require("../services/equipment/codeGenerator");
const { createInstanceFactory } = require("../services/equipment/instanceFactory");
const { createTemplateStore } = require("../services/equipment/templateStore");
const { registerAll } = require("../services/register-all");

test("numbered migrations upgrade into a fully registered service schema", () => {
  const dbPath = path.join(os.tmpdir(), `mes-schema-upgrade-${process.pid}-${Date.now()}.db`);
  try {
    childProcess.execFileSync("bash", [path.resolve(__dirname, "../scripts/migrate.sh")], {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, MIGRATE_DB_PATH: dbPath },
    });

    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    const app = express();
    instanceRoutes.register(app, db);
    registerAll(app, db);

    const bomForeignKey = db.prepare("PRAGMA foreign_key_list(process_nodes)").all()
      .find((foreignKey) => foreignKey.from === "bom_node_id");
    assert.equal(bomForeignKey?.table, "instance_bom");

    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    const migrationState = db.prepare(`
      SELECT COUNT(*) AS count,
             SUM(CASE WHEN ddl_fingerprint IS NULL THEN 1 ELSE 0 END) AS missing_fingerprints
      FROM service_schema_migrations
    `).get();
    assert.ok(migrationState.count > 0);
    assert.equal(migrationState.missing_fingerprints, 0);
    const tableCount = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get().count;
    assert.ok(tableCount > 100, `expected full MES schema, received ${tableCount} tables`);

    const source = db.prepare(`
      INSERT INTO equipment_instances (instance_code, instance_name, customer_name, status, lifecycle_stage)
      VALUES ('TBM-SOURCE-001', '模板来源', '测试客户', 'design', 'design')
    `).run();
    db.prepare(`
      INSERT INTO process_nodes (equipment_instance_id, operation_name, status)
      VALUES (?, '总装', 'ready')
    `).run(source.lastInsertRowid);

    const helpers = makeDbHelpers(db);
    const codeGenerator = createCodeGenerator(helpers.get);
    const templateStore = createTemplateStore({ get: helpers.get, ApiError });
    const factory = createInstanceFactory({
      db,
      ...helpers,
      ApiError,
      nextInstanceCode: codeGenerator.nextInstanceCode,
      templateStore,
    });
    const copied = factory.createInstance({
      instance_code: "TBM-COPY-001",
      instance_name: "复制项目",
      customer_name: "测试客户",
      template_instance_id: source.lastInsertRowid,
      generate_milestones: false,
      create_bom_shell: false,
      create_doc_dirs: false,
      copy_template_milestones: false,
      copy_template_bom: false,
      copy_template_process: true,
    }, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM process_nodes WHERE equipment_instance_id = ?").get(copied.id).count, 1);
    db.close();
  } finally {
    try { fs.unlinkSync(dbPath); } catch (_error) {}
  }
});
