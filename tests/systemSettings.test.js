"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const systemSettings = require("../services/systemSettings");
const { feishuNotify } = require("../services/feishuNotify");
const Database = require("better-sqlite3");

test("getFeishuConfig falls back to env when db is not initialized", () => {
  const oldToken = process.env.FEISHU_WEBHOOK_TOKEN;
  const oldTimeout = process.env.FEISHU_WEBHOOK_TIMEOUT_MS;
  process.env.FEISHU_WEBHOOK_TOKEN = "";
  process.env.FEISHU_WEBHOOK_TIMEOUT_MS = "1234";
  systemSettings.setDb(null);

  const cfg = systemSettings.getFeishuConfig();
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.webhook_token, "");
  assert.equal(cfg.timeout_ms, 1234);

  if (oldToken === undefined) delete process.env.FEISHU_WEBHOOK_TOKEN;
  else process.env.FEISHU_WEBHOOK_TOKEN = oldToken;
  if (oldTimeout === undefined) delete process.env.FEISHU_WEBHOOK_TIMEOUT_MS;
  else process.env.FEISHU_WEBHOOK_TIMEOUT_MS = oldTimeout;
});

test("feishuNotify skips cleanly without db and webhook", async () => {
  const oldToken = process.env.FEISHU_WEBHOOK_TOKEN;
  process.env.FEISHU_WEBHOOK_TOKEN = "";
  systemSettings.setDb(null);

  const result = await feishuNotify("P1 test", "no webhook should skip");
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);

  if (oldToken === undefined) delete process.env.FEISHU_WEBHOOK_TOKEN;
  else process.env.FEISHU_WEBHOOK_TOKEN = oldToken;
});


function makeSettingsDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE system_settings (
      key TEXT PRIMARY KEY, value TEXT, value_type TEXT, category TEXT,
      description TEXT, is_secret INTEGER DEFAULT 0, updated_by INTEGER, updated_at TEXT
    );
    INSERT INTO system_settings (key,value,value_type,category,description,is_secret) VALUES
      ('cert_expiry_alert_days','30','number','notification','证书临期天数',0),
      ('feishu_enabled','0','boolean','notification','飞书开关',0),
      ('feishu_webhook_token','https://open.feishu.cn/open-apis/bot/v2/hook/secret','string','notification','飞书 token',1),
      ('shop_timezone','Asia/Shanghai','string','general','时区',0),
      ('workday_start_time','08:00','string','schedule','上班时间',0),
      ('json_test','{"a":1}','json','general','JSON 测试',0);
  `);
  return db;
}

test("systemSettings 类型校验/敏感值保持/元数据", () => {
  const db = makeSettingsDb();
  systemSettings.setDb(db);
  let r = systemSettings.setOne("cert_expiry_alert_days", "abc", 1);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  r = systemSettings.setOne("cert_expiry_alert_days", "-1", 1);
  assert.equal(r.ok, false);
  r = systemSettings.setOne("cert_expiry_alert_days", "45", 1);
  assert.equal(r.ok, true);
  assert.equal(systemSettings.getNum("cert_expiry_alert_days", 30), 45);
  r = systemSettings.setOne("feishu_enabled", "true", 1);
  assert.equal(r.ok, true);
  assert.equal(systemSettings.getBool("feishu_enabled", false), true);
  r = systemSettings.setOne("feishu_enabled", "随便", 1);
  assert.equal(r.ok, false);
  r = systemSettings.setOne("json_test", "{bad", 1);
  assert.equal(r.ok, false);
  r = systemSettings.setOne("json_test", '{"b":2}', 1);
  assert.equal(r.ok, true);
  assert.deepEqual(systemSettings.getOne("json_test").value, { b: 2 });

  const before = systemSettings.getOne("feishu_webhook_token").value;
  r = systemSettings.setOne("feishu_webhook_token", "", 1);
  assert.equal(r.ok, true);
  assert.equal(r.kept, true);
  assert.equal(systemSettings.getOne("feishu_webhook_token").value, before);
  r = systemSettings.setOne("feishu_webhook_token", "", 1, { clearSecret: true });
  assert.equal(r.ok, true);
  assert.equal(systemSettings.getOne("feishu_webhook_token").is_set, false);

  const list = systemSettings.getAll();
  const cert = list.find((row) => row.key === "cert_expiry_alert_days");
  assert.equal(cert.implemented, false);
  assert.equal(cert.consumer, null);
  const tz = list.find((row) => row.key === "shop_timezone");
  assert.equal(tz.implemented, false);
  assert.match(tz.note, /预留/);
  db.close();
  systemSettings.setDb(null);
});

test("systemSettings 敏感参数不回显", () => {
  const db = makeSettingsDb();
  systemSettings.setDb(db);
  const item = systemSettings.getOne("feishu_webhook_token");
  assert.equal(item.value, null);
  assert.equal(item.is_secret, true);
  assert.equal(item.is_set, true);
  const all = systemSettings.getAll();
  assert.equal(all.find((row) => row.key === "feishu_webhook_token").value, null);
  db.close();
  systemSettings.setDb(null);
});
