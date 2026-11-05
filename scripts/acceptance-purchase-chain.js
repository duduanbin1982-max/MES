"use strict";
// scripts/acceptance-purchase-chain.js
// 2026-11-05：采购链路演练/验收（采购单 → 提交 → 审批 → 收货 → 来料检验 → 入库放行 → 发票 → 对账 → 关闭）
//
// 用法（服务已启动）：
//   node scripts/acceptance-purchase-chain.js            # 跑一遍并清理
//   node scripts/acceptance-purchase-chain.js --keep     # 保留演练数据
//   node scripts/acceptance-purchase-chain.js --material-id=1 --supplier-id=1
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
const MATERIAL_ID = Number(opt("material-id", 1));
const SUPPLIER_ID = Number(opt("supplier-id", 1));

const { signAccess } = require("../app/jwt");
const token = signAccess({ sub: 1, role: "admin", permissions: ["*"] }).token;

const results = [];
const created = { poId: null, lotIds: [], inventoryIds: [], receivingIds: [], invoiceIds: [], inspectionIds: [] };
let PO_NO = "";

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
  if (!created.poId) return;
  const db = new Database(path.join(ROOT, "data", "mes.db"));
  try {
    const receivingIds = db.prepare("SELECT id FROM purchase_receiving WHERE po_id = ?").all(created.poId).map((row) => row.id);
    const lotIds = db.prepare("SELECT material_lot_id FROM purchase_receiving WHERE po_id = ?").all(created.poId).map((row) => row.material_lot_id).filter(Boolean);
    for (const receivingId of receivingIds) {
      db.prepare("DELETE FROM incoming_inspections WHERE receiving_id = ?").run(receivingId);
    }
    db.prepare("DELETE FROM purchase_invoices WHERE po_id = ?").run(created.poId);
    db.prepare("DELETE FROM purchase_receiving WHERE po_id = ?").run(created.poId);
    for (const lotId of lotIds) {
      db.prepare("DELETE FROM inventory WHERE material_lot_id = ?").run(lotId);
      db.prepare("DELETE FROM material_movements WHERE material_lot_id = ?").run(lotId);
      db.prepare("DELETE FROM material_lots WHERE id = ?").run(lotId);
    }
    db.prepare("DELETE FROM po_lines WHERE po_id = ?").run(created.poId);
    db.prepare("DELETE FROM purchase_orders WHERE id = ?").run(created.poId);
    console.log(`[cleanup] 已清理演练采购单 ${PO_NO}（${receivingIds.length} 收货 / ${lotIds.length} 批次）`);
  } catch (error) {
    console.log(`[cleanup] 清理异常（可手工删 PO ${created.poId}）：${error.message}`);
  } finally {
    db.close();
  }
}

async function main() {
  const health = await request("GET", "/api/health");
  if (!health) throw new Error("服务健康检查失败");

  await step("1. 创建采购单（draft）", async (check) => {
    const suppliers = await request("GET", "/api/suppliers");
    const supplierId = (Array.isArray(suppliers) && suppliers.find((row) => row.id === SUPPLIER_ID)) ? SUPPLIER_ID : (suppliers[0] && suppliers[0].id);
    check("存在可用供应商", Boolean(supplierId), supplierId);
    const materials = await request("GET", "/api/materials");
    const materialId = (Array.isArray(materials) && materials.find((row) => row.id === MATERIAL_ID)) ? MATERIAL_ID : (materials[0] && materials[0].id);
    check("存在可用物料", Boolean(materialId), materialId);
    const po = await request("POST", "/api/purchase_orders", {
      supplier_id: supplierId,
      created_by: 3,
      expected_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      lines: [{ material_id: materialId, quantity: 10, unit_price: 100 }],
    });
    created.poId = po.id;
    PO_NO = po.po_no;
    check("采购单已创建", Boolean(po.id), po.po_no);
    check("初始状态 draft", (await request("GET", `/api/purchase_orders/${po.id}`)).status === "draft");
    check("金额计算正确", Number(po.total_amount) === 1000, po.total_amount);
  });

  await step("2. 提交 → 审批（approved_by，职责分离）", async (check) => {
    await request("PATCH", `/api/purchase_orders/${created.poId}/status`, { status: "submitted" });
    check("已提交", (await request("GET", `/api/purchase_orders/${created.poId}`)).status === "submitted");
    const confirmed = await request("PATCH", `/api/purchase_orders/${created.poId}/status`, { status: "confirmed", approved_by: 1 });
    check("审批通过", confirmed.ok === true && confirmed.status === "confirmed", confirmed.status);
    const detail = await request("GET", `/api/purchase_orders/${created.poId}`);
    check("记录审批人/时间", Boolean(detail.approved_by && detail.approved_at), { by: detail.approved_by, at: detail.approved_at });
    // 非法跳转验证
    let rejected = false;
    try { await request("PATCH", `/api/purchase_orders/${created.poId}/status`, { status: "received" }); } catch (_error) { rejected = true; }
    check("手工设置 received 被拒", rejected);
  });

  await step("3. 收货 → 待检隔离（部分收货）", async (check) => {
    const detail = await request("GET", `/api/purchase_orders/${created.poId}`);
    const lineId = detail.lines[0].id;
    const lotNo = `LOT-${PO_NO}-1`;
    const received = await request("POST", `/api/purchase_orders/${created.poId}/receive`, { lines: [{ line_id: lineId, received_qty: 4, lot_no: lotNo, location: "主仓-A-01" }] });
    check("部分收货状态", received.po_status === "partially_received", received.po_status);
    const lot = received.created_lots[0];
    created.lotIds.push(lot.lot_id);
    created.receivingIds.push(lot.receiving_id);
    const db = new Database(path.join(ROOT, "data", "mes.db"), { readonly: true });
    try {
      const inventory = db.prepare("SELECT * FROM inventory WHERE material_lot_id = ?").get(lot.lot_id);
      created.inventoryIds.push(inventory.id);
      check("库存进入待检隔离", inventory.status === "quarantined", inventory.status);
      check("批次记录供应商", Boolean(db.prepare("SELECT supplier FROM material_lots WHERE id = ?").get(lot.lot_id).supplier), lot.lot_no);
    } finally { db.close(); }
  });

  await step("4. 来料检验 → 放行（pass）", async (check) => {
    const receivingId = created.receivingIds[0];
    const pending = await request("GET", "/api/supplier-collab/pending-receipts");
    check("待检批次可查询", Array.isArray(pending), pending.length);
    const inspection = await request("POST", "/api/supplier-collab/incoming-inspections", {
      receiving_id: receivingId, result: "pass", defect_desc: "", defect_qty: 0,
    });
    check("检验登记成功", Boolean(inspection.id || inspection.inspection_id), inspection);
    if (inspection.id) created.inspectionIds.push(inspection.id);
    const db = new Database(path.join(ROOT, "data", "mes.db"), { readonly: true });
    try {
      const inventory = db.prepare("SELECT status FROM inventory WHERE id = ?").get(created.inventoryIds[0]);
      const receiving = db.prepare("SELECT quality_status FROM purchase_receiving WHERE id = ?").get(receivingId);
      check("检验合格后库存放行", inventory.status === "available", inventory.status);
      check("收货质量状态 pass", receiving.quality_status === "pass", receiving.quality_status);
    } finally { db.close(); }
  });

  await step("5. 全部收货 → received", async (check) => {
    const detail = await request("GET", `/api/purchase_orders/${created.poId}`);
    const received = await request("POST", `/api/purchase_orders/${created.poId}/receive`, {
      lines: [{ line_id: detail.lines[0].id, received_qty: 6, lot_no: `LOT-${PO_NO}-2` }],
    });
    check("全部收货状态", received.po_status === "received", received.po_status);
    for (const lot of received.created_lots) created.lotIds.push(lot.lot_id), created.receivingIds.push(lot.receiving_id);
    const after = await request("GET", `/api/purchase_orders/${created.poId}`);
    check("累计收货 = 订单数量", Number(after.lines[0].received_qty) === 10, after.lines[0].received_qty);
  });

  await step("6. 发票 → 对账（三单匹配）", async (check) => {
    const invoice = await request("POST", `/api/purchase_orders/${created.poId}/invoices`, {
      invoice_no: `INV-${PO_NO}`, amount: 1000, tax_amount: 130,
    });
    created.invoiceIds.push(invoice.id);
    check("发票录入成功", Boolean(invoice.id), invoice.invoice_no);
    const recon = await request("GET", `/api/purchase_orders/${created.poId}/reconciliation`);
    check("对账已匹配", recon.summary.status === "matched", recon.summary.status);
    check("已订=已收=已开票", recon.summary.ordered_amount === 1000 && recon.summary.received_amount === 1000 && recon.summary.invoiced_amount === 1000, recon.summary);
    check("差异为 0", recon.summary.variance === 0, recon.summary.variance);
    check("发票状态流转 pending→matched", (await request("PATCH", `/api/purchase_invoices/${invoice.id}`, { status: "matched" })).status === "matched");
  });

  await step("7. 关闭采购单", async (check) => {
    const closed = await request("PATCH", `/api/purchase_orders/${created.poId}/status`, { status: "closed" });
    check("关闭成功", closed.ok === true && closed.status === "closed");
    const detail = await request("GET", `/api/purchase_orders/${created.poId}`);
    check("记录关闭时间", Boolean(detail.closed_at), detail.closed_at);
  });

  const failed = results.filter((row) => !row.ok);
  const checks = results.reduce((sum, row) => sum + row.checks.length, 0);
  const passed = results.reduce((sum, row) => sum + row.checks.filter((item) => item.ok).length, 0);
  console.log(`\n=== 采购链路演练：${results.length - failed.length}/${results.length} 步，${passed}/${checks} 项检查 ===`);

  if (!KEEP) cleanup();
  else console.log("[keep] 保留演练数据");

  const dir = path.join(ROOT, "logs", "acceptance");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const md = [`# 采购链路演练报告（${PO_NO}）`, "", `- 时间：${new Date().toISOString()}`, `- 结果：**${failed.length === 0 ? "通过" : "未通过"}**（${results.length - failed.length}/${results.length} 步，${passed}/${checks} 项）`, "", "| 步骤 | 结果 | 检查 | 错误 |", "|---|---|---|---|",
    ...results.map((row) => `| ${row.name} | ${row.ok ? "✅" : "❌"} | ${row.checks.filter((item) => item.ok).length}/${row.checks.length} | ${row.error || ""} |`)];
  for (const row of results) {
    md.push("", `## ${row.ok ? "✅" : "❌"} ${row.name}`, "");
    for (const check of row.checks) md.push(`- ${check.ok ? "✅" : "❌"} ${check.name}${check.detail === null ? "" : ` — \`${JSON.stringify(check.detail).slice(0, 120)}\``}`);
    if (row.error) md.push(`- 失败原因：${row.error}`);
  }
  fs.writeFileSync(path.join(dir, `purchase-chain-${ts}.md`), md.join("\n"));
  console.log(`报告：${path.join(dir, `purchase-chain-${ts}.md`)}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => { console.error("演练脚本异常：", error.message); process.exitCode = 1; });
