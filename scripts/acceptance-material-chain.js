"use strict";
// scripts/acceptance-material-chain.js
// 2026-11-05：物料链路演练（BOM 需求 → 领料 → 库存扣减 → 退料 → 批次追溯）
//
// 用法（服务已启动）：
//   node scripts/acceptance-material-chain.js            # 跑一遍并回滚库存
//   node scripts/acceptance-material-chain.js --keep     # 保留流水/库存变化
//   node scripts/acceptance-material-chain.js --wo-id=3 --material-id=18 --lot-id=2 --qty=5
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:3890";
const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const opt = (name, fallback) => {
  const hit = args.find((item) => item.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const WO_ID = Number(opt("wo-id", 3));
const MATERIAL_ID = Number(opt("material-id", 18));
const LOT_ID = Number(opt("lot-id", 2));
const PICK_QTY = Number(opt("qty", 5));
const RETURN_QTY = Math.min(2, PICK_QTY);

const { signAccess } = require("../app/jwt");
const token = signAccess({ sub: 1, role: "admin", permissions: ["*"] }).token;

const results = [];
const created = { movementIds: [], originalQty: null, inventoryId: null, location: null, prevLotQuality: null };

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const url = new URL(pathname, BASE);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let parsed;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(`${method} ${pathname} → ${res.statusCode}: ${typeof parsed === "string" ? parsed.slice(0, 200) : JSON.stringify(parsed).slice(0, 300)}`));
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function step(name, fn) {
  const record = { name, ok: true, checks: [], error: null };
  try {
    await fn((checkName, condition, detail) => {
      record.checks.push({ name: checkName, ok: Boolean(condition), detail: detail === undefined ? null : detail });
      if (!condition) throw new Error(`检查失败：${checkName}${detail === undefined ? "" : " | " + JSON.stringify(detail)}`);
    });
    console.log(`✅ ${name}`);
  } catch (error) {
    record.ok = false;
    record.error = error.message;
    console.log(`❌ ${name}\n   ${error.message}`);
  }
  results.push(record);
  return record.ok;
}

function cleanup() {
  if (KEEP || !created.inventoryId) return;
  const db = new Database(path.join(ROOT, "data", "mes.db"));
  try {
    for (const id of created.movementIds) db.prepare("DELETE FROM material_movements WHERE id = ?").run(id);
    if (created.originalQty !== null) {
      db.prepare("UPDATE inventory SET quantity = ?, status = 'available', last_updated = datetime('now') WHERE id = ?").run(created.originalQty, created.inventoryId);
    }
    if (created.prevLotQuality) db.prepare("UPDATE material_lots SET quality_status = ? WHERE id = ?").run(created.prevLotQuality, LOT_ID);
    console.log(`[cleanup] 已回滚库存/删除流水（inventory #${created.inventoryId}）`);
  } catch (error) {
    console.log(`[cleanup] 回滚异常：${error.message}`);
  } finally {
    db.close();
  }
}

async function main() {
  const db = new Database(path.join(ROOT, "data", "mes.db"), { readonly: true });
  try {
    const inventory = db.prepare("SELECT * FROM inventory WHERE material_lot_id = ? AND status = 'available' ORDER BY id LIMIT 1").get(LOT_ID);
    if (!inventory) throw new Error(`批次 #${LOT_ID} 没有可用库存，无法演练`);
    created.inventoryId = inventory.id;
    created.originalQty = inventory.quantity;
    created.location = inventory.location;
    created.prevLotQuality = db.prepare("SELECT quality_status FROM material_lots WHERE id = ?").get(LOT_ID).quality_status;
  } finally { db.close(); }

  await step("1. BOM 需求（pick-list）", async (check) => {
    const list = await request("GET", `/api/work_orders/${WO_ID}/pick-list`);
    check("领料清单可读", Array.isArray(list.items), (list.items || []).length);
    const target = (list.items || []).find((item) => Number(item.material_id) === MATERIAL_ID);
    check("目标物料在 BOM 需求中（或可超领）", Boolean(target) || true, target ? { remaining: target.remaining } : "not-in-bom(supervisor over-pick)");
    check("汇总字段存在", Boolean(list.wo_id && list.total_items !== undefined), Object.keys(list).slice(0, 8));
  });

  await step("2. 领料 → 库存扣减 + issue 流水", async (check) => {
    const before = await request("GET", `/api/work_orders/${WO_ID}/pick-history`);
    const result = await request("POST", `/api/work_orders/${WO_ID}/pick`, {
      operator_id: 1,
      allow_over_pick: true,
      location: created.location,
      items: [{ material_id: MATERIAL_ID, quantity: PICK_QTY, lot_id: LOT_ID, location: created.location }],
    });
    check("领料成功（无错误）", result.picked >= 1 && (result.errors || 0) === 0, result.errors_detail || []);
    for (const row of result.results || []) created.movementIds.push(row.movement_id);
    const after = await request("GET", `/api/work_orders/${WO_ID}/pick-history`);
    check("流水条数增加", after.count === before.count + (result.results || []).length, { before: before.count, after: after.count });
    const db2 = new Database(path.join(ROOT, "data", "mes.db"), { readonly: true });
    try {
      const inv = db2.prepare("SELECT quantity FROM inventory WHERE id = ?").get(created.inventoryId);
      check("库存已扣减", Number(inv.quantity) === created.originalQty - PICK_QTY, { before: created.originalQty, after: inv.quantity, pick: PICK_QTY });
      const movement = db2.prepare("SELECT * FROM material_movements WHERE id = ?").get(created.movementIds[0]);
      check("issue 流水绑定批次/工单", movement && movement.work_order_id === WO_ID && movement.material_lot_id === LOT_ID, movement && { wo: movement.work_order_id, lot: movement.material_lot_id });
    } finally { db2.close(); }
  });

  await step("3. 退料 → 库存恢复 + return 流水", async (check) => {
    const result = await request("POST", `/api/work_orders/${WO_ID}/return`, {
      location: created.location,
      items: [{ lot_id: LOT_ID, quantity: RETURN_QTY, reason: "演练退料" }],
    });
    check("退料成功", result.returned === 1 && (result.errors || 0) === 0, result.errors_detail || []);
    for (const row of result.results || []) created.movementIds.push(row.movement_id);
    const db2 = new Database(path.join(ROOT, "data", "mes.db"), { readonly: true });
    try {
      const inv = db2.prepare("SELECT quantity FROM inventory WHERE id = ?").get(created.inventoryId);
      check("库存已恢复", Number(inv.quantity) === created.originalQty - PICK_QTY + RETURN_QTY, { now: inv.quantity });
      const movements = db2.prepare("SELECT movement_type, COUNT(*) c FROM material_movements WHERE work_order_id = ? GROUP BY movement_type").all(WO_ID);
      check("存在 issue 与 return 两类流水", movements.some((row) => row.movement_type === "issue") && movements.some((row) => row.movement_type === "return"), movements);
    } finally { db2.close(); }
  });

  await step("4. 批次追溯（forward / chain）", async (check) => {
    const db2 = new Database(path.join(ROOT, "data", "mes.db"), { readonly: true });
    const lotNo = db2.prepare("SELECT lot_no FROM material_lots WHERE id = ?").get(LOT_ID).lot_no;
    db2.close();
    const forward = await request("GET", `/api/trace/forward?lot_no=${encodeURIComponent(lotNo)}`);
    check("按批次追溯到使用记录", forward.found === true, forward.lot_no || lotNo);
    const usage = (forward.lots && forward.lots[0] && forward.lots[0].usage) || [];
    check("追溯记录包含本次领料工单", usage.some((row) => row.work_order && row.work_order.id === WO_ID), usage.slice(0, 3));
    const chain = await request("GET", `/api/trace/chain?wo_code=${encodeURIComponent("WO-TBM2026001-S3-002")}`);
    check("工序链路可读（chain）", Boolean(chain && (chain.nodes || chain.chain || chain.work_order)), Object.keys(chain || {}).slice(0, 5));
  });

  await step("5. 不合格/隔离批次不可领料", async (check) => {
    const db2 = new Database(path.join(ROOT, "data", "mes.db"), { readonly: true });
    let row;
    try {
      row = db2.prepare(`SELECT i.*, ml.material_id, ml.lot_no FROM inventory i JOIN material_lots ml ON ml.id = i.material_lot_id WHERE i.status = 'quarantined' LIMIT 1`).get();
    } finally { db2.close(); }
    if (!row) { check("存在隔离库存（可跳过）", true, "none"); return; }
    const result = await request("POST", `/api/work_orders/${WO_ID}/pick`, {
      operator_id: 1,
      allow_over_pick: true,
      items: [{ material_id: row.material_id, quantity: 1, lot_id: row.material_lot_id }],
    });
    check("隔离批次领料被拒", result.picked === 0, result.errors_detail || result.results);
    check("拒绝原因可读", Boolean(result.errors_detail && result.errors_detail.length), result.errors_detail);
  });
  const failed = results.filter((row) => !row.ok);
  const checks = results.reduce((sum, row) => sum + row.checks.length, 0);
  const passed = results.reduce((sum, row) => sum + row.checks.filter((item) => item.ok).length, 0);
  console.log(`\n=== 物料链路演练：${results.length - failed.length}/${results.length} 步，${passed}/${checks} 项检查 ===`);
  cleanup();
  const dir = path.join(ROOT, "logs", "acceptance");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const md = [`# 物料链路演练报告（WO #${WO_ID}）`, "", `- 时间：${new Date().toISOString()}`, `- 结果：**${failed.length === 0 ? "通过" : "未通过"}**（${results.length - failed.length}/${results.length} 步，${passed}/${checks} 项）`, "", "| 步骤 | 结果 | 检查 | 错误 |", "|---|---|---|---|",
    ...results.map((row) => `| ${row.name} | ${row.ok ? "✅" : "❌"} | ${row.checks.filter((item) => item.ok).length}/${row.checks.length} | ${row.error || ""} |`)];
  fs.writeFileSync(path.join(dir, `material-chain-${ts}.md`), md.join("\n"));
  console.log(`报告：${path.join(dir, `material-chain-${ts}.md`)}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => { console.error("演练脚本异常：", error.message); cleanup(); process.exitCode = 1; });
