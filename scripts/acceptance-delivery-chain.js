"use strict";
// scripts/acceptance-delivery-chain.js
// 2026-11-05：交付链路演练（里程碑 → 交付单发运 → 验收签署 → 收款 → 看板汇总）
// 用法：node scripts/acceptance-delivery-chain.js [--keep] [--instance-id=8]
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
const INSTANCE_ID = Number(opt("instance-id", 8));
const { signAccess } = require("../app/jwt");
const token = signAccess({ sub: 1, role: "admin", permissions: ["*"] }).token;

const results = [];
const created = { deliveryId: null, acceptanceId: null, milestoneId: null, paymentId: null, paymentVoucher: null };

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
  if (KEEP) return;
  const db = new Database(path.join(ROOT, "data", "mes.db"));
  try {
    if (created.paymentId) db.prepare("DELETE FROM project_payments WHERE id = ?").run(created.paymentId);
    if (created.acceptanceId) db.prepare("DELETE FROM acceptance_records WHERE id = ?").run(created.acceptanceId);
    if (created.deliveryId) db.prepare("DELETE FROM delivery_orders WHERE id = ?").run(created.deliveryId);
    if (created.milestoneId) db.prepare("DELETE FROM contract_milestones WHERE id = ?").run(created.milestoneId);
    console.log("[cleanup] 已清理演练数据（交付单/验收单/里程碑/收款）");
  } catch (error) {
    console.log("[cleanup] 清理异常：" + error.message);
  } finally { db.close(); }
}

async function main() {
  await step("1. 创建交付单（planned）", async (check) => {
    const result = await request("POST", `/api/equipment_instances/${INSTANCE_ID}/deliveries`, {
      delivery_type: "machine", planned_date: "2026-12-01", transport_mode: "road", carrier: "演练承运",
    });
    created.deliveryId = result.item.id;
    check("交付单已创建", Boolean(result.item.id), result.delivery_no);
    check("初始状态 planned", result.item.status === "planned", result.item.status);
  });

  await step("2. 发运 → 到达（状态机 + 实际日期）", async (check) => {
    for (const status of ["shipped", "in_transit", "arrived"]) {
      const result = await request("POST", `/api/deliveries/${created.deliveryId}/status`, { status });
      check(`状态流转到 ${status}`, result.item.status === status, result.item.status);
    }
    const detail = await request("GET", `/api/equipment_instances/${INSTANCE_ID}/deliveries`);
    const row = detail.items.find((item) => item.id === created.deliveryId);
    check("记录实际日期（本地）", /^\d{4}-\d{2}-\d{2}$/.test(String(row.actual_date || "")), row.actual_date);
  });

  await step("3. 合同里程碑 + 验收单（关联交付单）", async (check) => {
    const milestone = await request("POST", "/api/contract-milestones", {
      equipment_instance_id: INSTANCE_ID, milestone_name: "演练-发货款", payment_pct: 30, payment_amount: 30000, status: "pending",
    });
    created.milestoneId = milestone.id;
    check("合同里程碑已创建", Boolean(milestone.id), milestone.id);
    const acceptance = await request("POST", `/api/equipment_instances/${INSTANCE_ID}/acceptances`, {
      acceptance_type: "sat", delivery_order_id: created.deliveryId, milestone_id: created.milestoneId, planned_date: "2026-12-05",
    });
    created.acceptanceId = acceptance.id;
    check("验收单已创建", Boolean(acceptance.id), acceptance.acceptance_no);
  });

  await step("4. 客户签署 passed → 联动交付单/里程碑", async (check) => {
    const signed = await request("POST", `/api/acceptances/${created.acceptanceId}/sign`, {
      result: "passed", signer_name: "演练客户代表", signer_title: "设备经理",
    });
    check("签署成功", signed.ok === true && signed.item.result === "passed", signed.item.result);
    check("无联动告警", Array.isArray(signed.warnings) && signed.warnings.length === 0, signed.warnings);
    const deliveries = await request("GET", `/api/equipment_instances/${INSTANCE_ID}/deliveries`);
    const delivery = deliveries.items.find((item) => item.id === created.deliveryId);
    check("交付单自动置 accepted", delivery.status === "accepted", delivery.status);
    const db = new Database(path.join(ROOT, "data", "mes.db"), { readonly: true });
    try {
      const milestone = db.prepare("SELECT status FROM contract_milestones WHERE id = ?").get(created.milestoneId);
      check("合同里程碑置 completed", milestone.status === "completed", milestone.status);
    } finally { db.close(); }
  });

  await step("5. 收款登记 + 项目汇总", async (check) => {
    created.paymentVoucher = "PAY-DRILL-" + Date.now();
    const payment = await request("POST", "/api/project-payments", {
      equipment_instance_id: INSTANCE_ID, milestone_id: created.milestoneId, amount: 30000, voucher_no: created.paymentVoucher, payment_method: "bank",
    });
    created.paymentId = payment.id;
    check("收款登记成功", Boolean(payment.id), { amount: payment.amount, date: payment.received_date });
    check("收款日期为本地日期", /^\d{4}-\d{2}-\d{2}$/.test(String(payment.received_date)), payment.received_date);
    let rejected = false;
    try { await request("POST", "/api/project-payments", { equipment_instance_id: INSTANCE_ID, amount: 1, voucher_no: created.paymentVoucher }); } catch (_error) { rejected = true; }
    check("重复凭证号被拒", rejected);
    const summary = await request("GET", `/api/project-summary/${INSTANCE_ID}`);
    check("项目汇总包含收款", Number(summary.total_payment) >= 30000, summary.total_payment);
  });

  await step("6. 交付看板汇总（交付/验收/回款）", async (check) => {
    const overview = await request("GET", "/api/delivery/overview");
    check("看板含交付统计", overview.summary.deliveries && overview.summary.deliveries.total >= 1, overview.summary.deliveries);
    check("看板含验收统计", overview.summary.acceptances && overview.summary.acceptances.total >= 1, overview.summary.acceptances);
    check("看板含回款统计", overview.summary.payments && Number(overview.summary.payments.total_amount) >= 30000, overview.summary.payments);
  });

  const failed = results.filter((row) => !row.ok);
  const checks = results.reduce((sum, row) => sum + row.checks.length, 0);
  const passed = results.reduce((sum, row) => sum + row.checks.filter((item) => item.ok).length, 0);
  console.log(`\n=== 交付链路演练：${results.length - failed.length}/${results.length} 步，${passed}/${checks} 项检查 ===`);
  cleanup();
  const dir = path.join(ROOT, "logs", "acceptance");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const md = [`# 交付链路演练报告（实例 #${INSTANCE_ID}）`, "", `- 时间：${new Date().toISOString()}`, `- 结果：**${failed.length === 0 ? "通过" : "未通过"}**（${results.length - failed.length}/${results.length} 步，${passed}/${checks} 项）`, "", "| 步骤 | 结果 | 检查 | 错误 |", "|---|---|---|---|",
    ...results.map((row) => `| ${row.name} | ${row.ok ? "✅" : "❌"} | ${row.checks.filter((item) => item.ok).length}/${row.checks.length} | ${row.error || ""} |`)];
  fs.writeFileSync(path.join(dir, `delivery-chain-${ts}.md`), md.join("\n"));
  console.log(`报告：${path.join(dir, `delivery-chain-${ts}.md`)}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => { console.error("演练脚本异常：", error.message); cleanup(); process.exitCode = 1; });
