"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const systemSettings = require("../services/systemSettings");
const { feishuNotify } = require("../services/feishuNotify");

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
