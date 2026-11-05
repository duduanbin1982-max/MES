"use strict";
// scripts/acceptance-e2e.js
// 2026-11-05：TBM-DEMO-001 端到端验收脚本（项目 → 里程碑 → 工序计划 → 排程 → 工单派工/报工 → 质检 → OEE）。
//
// 特点：
//   · 全部走真实 HTTP API（等价现场操作），不是直接改库；
//   · 每一步都有断言（自动核对清单），失败即退出码 1；
//   · 只操作演练项目实例（默认 TBM-DEMO-001），可用 --reset 清理演练数据后重跑；
//   · 默认结束后清理本次创建的数据（保留里程碑），--keep 可保留成演示数据；
//   · 报告写入 logs/acceptance/e2e-<ts>.json 与 .md。
//
// 用法：
//   node scripts/acceptance-e2e.js                # 跑一遍并清理
//   node scripts/acceptance-e2e.js --reset        # 先清演练数据再跑
//   node scripts/acceptance-e2e.js --keep         # 保留本次创建的数据（演示用）
//   node scripts/acceptance-e2e.js --instance-code=TBM-DEMO-001 --base-url=http://127.0.0.1:3890
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes("--" + name);
const opt = (name, fallback) => {
  const hit = args.find((item) => item.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE_URL = opt("base-url", "http://127.0.0.1:3890");
const INSTANCE_CODE = opt("instance-code", "TBM-DEMO-001");
const KEEP = flag("keep");
const RESET = flag("reset");
const TS = new Date().toISOString().replace(/[:.]/g, "-");

const results = [];
const created = { nodeIds: [], depIds: [], workOrderIds: [], qcIds: [], shiftLogIds: [] };

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const url = new URL(pathname, BASE_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          let parsed;
          try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(`${method} ${pathname} → ${res.statusCode}: ${typeof parsed === "string" ? parsed.slice(0, 200) : JSON.stringify(parsed).slice(0, 300)}`));
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function assert(condition, message, extra) {
  if (!condition) {
    const suffix = extra === undefined ? "" : ` | ${typeof extra === "string" ? extra : JSON.stringify(extra)}`;
    throw new Error(message + suffix);
  }
}

async function step(name, fn) {
  const record = { name, ok: true, checks: [], error: null, durationMs: 0 };
  const started = Date.now();
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
  record.durationMs = Date.now() - started;
  results.push(record);
  return record.ok;
}

/** 清理演练项目的业务数据（里程碑保留） */
function resetDemoData(instanceId) {
  const Database = require("better-sqlite3");
  const db = new Database(path.join(ROOT, "data", "mes.db"));
  try {
    const woIds = db.prepare("SELECT id FROM work_orders WHERE equipment_instance_id = ?").all(instanceId).map((row) => row.id);
    for (const id of woIds) {
      const instances = db.prepare("SELECT id FROM workflow_instances WHERE entity_type = 'work_order' AND entity_id = ?").all(id).map((row) => row.id);
      for (const wi of instances) db.prepare("DELETE FROM workflow_history WHERE instance_id = ?").run(wi);
      db.prepare("DELETE FROM workflow_instances WHERE entity_type = 'work_order' AND entity_id = ?").run(id);
      db.prepare("DELETE FROM resource_allocations WHERE work_order_id = ?").run(id);
      db.prepare("DELETE FROM work_order_operations WHERE work_order_id = ?").run(id);
      db.prepare("DELETE FROM work_orders WHERE id = ?").run(id);
    }
    db.prepare("DELETE FROM qc_inspections WHERE equipment_instance_id = ?").run(instanceId);
    db.prepare("DELETE FROM oee_shift_log WHERE equipment_instance_id = ?").run(instanceId);
    db.prepare("DELETE FROM process_dependencies WHERE equipment_instance_id = ?").run(instanceId);
    db.prepare("DELETE FROM process_nodes WHERE equipment_instance_id = ?").run(instanceId);
    console.log(`[reset] 已清理演练项目 #${instanceId} 的工序/依赖/工单/质检/班次数据（里程碑保留）`);
  } finally {
    db.close();
  }
}

/** 结束后清理本次创建的数据 */
function cleanupCreated(instanceId) {
  const Database = require("better-sqlite3");
  const db = new Database(path.join(ROOT, "data", "mes.db"));
  try {
    for (const id of created.workOrderIds) {
      const instances = db.prepare("SELECT id FROM workflow_instances WHERE entity_type = 'work_order' AND entity_id = ?").all(id).map((row) => row.id);
      for (const wi of instances) db.prepare("DELETE FROM workflow_history WHERE instance_id = ?").run(wi);
      db.prepare("DELETE FROM workflow_instances WHERE entity_type = 'work_order' AND entity_id = ?").run(id);
      db.prepare("DELETE FROM resource_allocations WHERE work_order_id = ?").run(id);
      db.prepare("DELETE FROM work_order_operations WHERE work_order_id = ?").run(id);
      db.prepare("DELETE FROM work_orders WHERE id = ?").run(id);
    }
    for (const id of created.qcIds) db.prepare("DELETE FROM qc_inspections WHERE id = ?").run(id);
    for (const id of created.shiftLogIds) db.prepare("DELETE FROM oee_shift_log WHERE id = ?").run(id);
    for (const id of created.depIds) db.prepare("DELETE FROM process_dependencies WHERE id = ?").run(id);
    for (const id of created.nodeIds) db.prepare("DELETE FROM process_nodes WHERE id = ?").run(id);
    console.log(`[cleanup] 已清理本次创建的 ${created.nodeIds.length} 工序 / ${created.depIds.length} 依赖 / ${created.workOrderIds.length} 工单 / ${created.qcIds.length} 质检 / ${created.shiftLogIds.length} 班次`);
  } finally {
    db.close();
  }
}

let token = "";
let instance = null;

async function main() {
  const { signAccess } = require("../app/jwt");
  token = signAccess({ sub: 1, role: "admin", permissions: ["*"] }).token;

  const health = await request("GET", "/api/health");
  assert(health && health.ok !== false, "服务健康检查失败");

  const instances = await request("GET", "/api/equipment_instances");
  instance = (Array.isArray(instances) ? instances : instances.items || []).find((row) => row.instance_code === INSTANCE_CODE);
  assert(instance, `找不到演练项目 ${INSTANCE_CODE}（可先创建项目或改 --instance-code）`);

  if (RESET) resetDemoData(instance.id);

  // ---------------------------------------------------------------- 1. 项目
  await step("1. 项目（TBM-DEMO-001）", async (check) => {
    const detail = await request("GET", `/api/equipment_instances/${instance.id}`);
    check("项目可读取", Boolean(detail && detail.instance_code === INSTANCE_CODE), detail && detail.instance_code);
    check("项目有生命周期状态", Boolean(detail.lifecycle_stage || detail.status), detail.lifecycle_stage || detail.status);
  });

  // ---------------------------------------------------------------- 2. 里程碑
  await step("2. 里程碑（计划日期完整、可推进）", async (check) => {
    let milestones = await request("GET", `/api/equipment_instances/${instance.id}/milestones`);
    check("里程碑存在", Array.isArray(milestones) && milestones.length > 0, milestones.length);
    const missing = milestones.filter((row) => !row.planned_start || !row.planned_end);
    if (missing.length) {
      const preview = await request("POST", `/api/equipment_instances/${instance.id}/milestones/backfill?dryRun=1`, {});
      check("可补齐缺失计划日期", preview.changed_count > 0, preview.changed_count);
      const applied = await request("POST", `/api/equipment_instances/${instance.id}/milestones/backfill`, {});
      check("补齐执行成功", applied.updated > 0, applied.updated);
      milestones = await request("GET", `/api/equipment_instances/${instance.id}/milestones`);
    }
    check("全部里程碑有计划起止", milestones.every((row) => row.planned_start && row.planned_end), milestones.length);
    const sorted = [...milestones].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    let monotonic = true;
    for (let i = 1; i < sorted.length; i++) {
      if (String(sorted[i].planned_start) < String(sorted[i - 1].planned_start)) monotonic = false;
    }
    check("里程碑计划日期按阶段递增", monotonic);
    const current = sorted.find((row) => row.status === "active") || sorted.find((row) => row.status === "pending");
    check("存在可推进的里程碑", Boolean(current), current && current.phase_code);
    if (current) {
      const target = current.status === "active" ? "completed" : "active";
      const updated = await request("PUT", `/api/milestones/${current.id}`, { status: target });
      check(`里程碑推进 ${current.phase_code} → ${target}`, updated.milestone && updated.milestone.status === target, updated.milestone && updated.milestone.status);
    }
  });

  // ---------------------------------------------------------------- 3. 工序计划
  const nodeIds = [];
  await step("3. 工序计划（建 4 道工序 + 3 条 FS 依赖）", async (check) => {
    const plan = [
      { name: "下料", hours: 8, ws: 1, phase: "S3", sequence: 1, skill: "cutting" },
      { name: "卷制/成型", hours: 16, ws: 2, phase: "S3", sequence: 2, skill: "rolling" },
      { name: "焊接", hours: 8, ws: 3, phase: "S3", sequence: 3, skill: "welding" },
      { name: "检验", hours: 4, ws: 9, phase: "S3", sequence: 4, skill: "inspection" },
    ];
    for (const item of plan) {
      const node = await request("POST", "/api/process_nodes", {
        equipment_instance_id: instance.id,
        operation_name: item.name,
        sequence: item.sequence,
        estimated_hours: item.hours,
        required_workstation_id: item.ws,
        required_skill: item.skill,
        phase_code: item.phase,
      });
      assert(node.id, `创建工序失败：${item.name}`);
      created.nodeIds.push(node.id);
      nodeIds.push(node.id);
    }
    check("4 道工序创建成功", nodeIds.length === 4, nodeIds);
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const dep = await request("POST", "/api/process_dependencies", {
        equipment_instance_id: instance.id,
        predecessor_id: nodeIds[i],
        successor_id: nodeIds[i + 1],
        dep_type: "FS",
        lag_hours: 0,
      });
      assert(dep.id, "创建依赖失败");
      created.depIds.push(dep.id);
    }
    check("3 条依赖创建成功", created.depIds.length === 3, created.depIds);
    const tree = await request("GET", `/api/equipment_instances/${instance.id}/process_tree`);
    check("工序树可读取", Array.isArray(tree.flat) && tree.flat.length === 4, tree.flat && tree.flat.length);
    check("依赖出现在工序树", Array.isArray(tree.deps) && tree.deps.length === 3, tree.deps && tree.deps.length);
  });

  // ---------------------------------------------------------------- 4. 排程
  await step("4. 排程（按依赖 + 工位生成计划时间）", async (check) => {
    const preview = await request("POST", `/api/equipment_instances/${instance.id}/schedule?dryRun=1&start=${instance.planned_start || "2026-11-01"}`, {});
    check("排程预演无错误", (preview.errors || []).length === 0, preview.errors);
    check("排程预演有变更", preview.changed_count > 0, preview.changed_count);
    check("预演不写库", preview.written_count === 0, preview.written_count);
    const applied = await request("POST", `/api/equipment_instances/${instance.id}/schedule?start=${instance.planned_start || "2026-11-01"}`, {});
    check("排程应用成功", applied.written_count > 0, applied.written_count);
    check("排程记录批次", /^SC-/.test(String(applied.batch_no)), applied.batch_no);

    const tree = await request("GET", `/api/equipment_instances/${instance.id}/process_tree`);
    const byId = new Map(tree.flat.map((row) => [row.id, row]));
    const nodes = nodeIds.map((id) => byId.get(id));
    check("全部工序有计划时间", nodes.every((row) => row && row.planned_start && row.planned_end), nodes.map((row) => row && row.planned_start));
    const start = (row) => new Date(String(row.planned_start).replace(" ", "T"));
    const end = (row) => new Date(String(row.planned_end).replace(" ", "T"));
    let ordered = true;
    for (let i = 1; i < nodes.length; i++) {
      if (start(nodes[i]) < end(nodes[i - 1])) ordered = false;
    }
    check("FS 依赖顺序满足（后继开始 ≥ 前驱结束）", ordered);
    const reversed = await request("PUT", `/api/schedule/process-nodes/${nodeIds[2]}/dates`, {
      planned_start: nodes[0].planned_start,
      planned_end: nodes[2].planned_end,
    }).then((result) => result).catch((error) => ({ error }));
    check("拖拽改期返回批次/告警", Boolean(reversed && (reversed.batch_no || reversed.error)), reversed && (reversed.batch_no || reversed.error && reversed.error.message));
  });

  // ---------------------------------------------------------------- 5. 工单派工 / 报工
  let workOrder = null;
  await step("5. 工单派工 / 开工 / 报工（关联工序）", async (check) => {
    const demoCode = `WO-DEMO-${Date.now().toString().slice(-6)}`;
    const createdOrder = await request("POST", "/api/work_orders", {
      wo_code: demoCode,
      equipment_instance_id: instance.id,
      title: "验收：下料",
      estimated_hours: 8,
      quantity_planned: 1,
      process_node_id: nodeIds[0],
      planned_start: "2026-11-01 08:00:00",
      planned_end: "2026-11-01 16:00:00",
    });
    assert(createdOrder.id, "创建工单失败");
    workOrder = createdOrder.id;
    created.workOrderIds.push(workOrder);
    const detail = await request("GET", `/api/work_orders/${workOrder}`);
    check("工单已关联工序", detail.process_node_id === nodeIds[0], { node: detail.process_node_id, name: detail.process_node_name });
    const dispatched = await request("PUT", `/api/work_orders/${workOrder}/dispatch`, {
      user_id: 3,
      workstation_id: 1,
      planned_start: "2026-11-01 08:00:00",
      planned_end: "2026-11-01 16:00:00",
    });
    check("派工成功（已派工状态）", dispatched.status === "dispatched", dispatched.status);
    const started = await request("POST", `/api/work_orders/${workOrder}/operations`, { operator_id: 3, action: "start", hours_worked: 8 });
    check("开工操作成功", Boolean(started.id), started.id);
    const afterStart = await request("GET", `/api/work_orders/${workOrder}`);
    check("开工后状态为进行中", afterStart.status === "in_progress", afterStart.status);
    const reported = await request("POST", `/api/work_orders/${workOrder}/report`, { user_id: 3, hours_worked: 8, quantity_completed: 1, notes: "验收报工" });
    check("报工成功", Boolean(reported.id), reported.id);
    check("报工不超报", reported.over_reported !== true, reported.over_reported);
    const afterReport = await request("GET", `/api/work_orders/${workOrder}`);
    check("报工达标后自动完工", afterReport.status === "completed", afterReport.status);
    check("累计完成数量 = 计划数量", Number(afterReport.quantity_completed) === Number(afterReport.quantity_planned), { done: afterReport.quantity_completed, planned: afterReport.quantity_planned });
  });

  // ---------------------------------------------------------------- 6. 质检
  await step("6. 质检（检验记录 + 统计口径）", async (check) => {
    const before = await request("GET", "/api/qc/stats");
    const inspection = await request("POST", "/api/qc_inspections", {
      equipment_instance_id: instance.id,
      work_order_id: workOrder,
      inspection_type: "final",
      result: "pass",
      inspector_id: 5,
      notes: "验收：终检合格",
    });
    assert(inspection.id, "创建质检记录失败");
    created.qcIds.push(inspection.id);
    check("质检记录已创建", Boolean(inspection.id), inspection.id);
    const list = await request("GET", `/api/qc_inspections?equipment_instance_id=${instance.id}&work_order_id=${workOrder}`);
    check("可按工单查回质检记录", Array.isArray(list) && list.length >= 1, list.length);
    const after = await request("GET", "/api/qc/stats");
    check("质检统计条数递增", Number(after.total) === Number(before.total) + 1, { before: before.total, after: after.total });
    const dashboard = await request("GET", "/api/qc/dashboard");
    check("质量看板可读取", dashboard && typeof dashboard.ncr_open === "number", dashboard && Object.keys(dashboard).slice(0, 4));
  });

  // ---------------------------------------------------------------- 7. OEE
  await step("7. OEE（补录班次 → 口径可算）", async (check) => {
    const day = new Date();
    const shiftDates = [1, 2].map((offset) => {
      const date = new Date(day.getTime() - offset * 86400000);
      return date.toISOString().slice(0, 10);
    });
    for (const shiftDate of shiftDates) {
      const shift = await request("POST", "/api/oee/shift-log", {
        equipment_instance_id: instance.id,
        shift_date: shiftDate,
        shift_name: "白班",
        shift_minutes: 480,
        planned_stop_minutes: 30,
        operating_minutes: 400,
        fault_minutes: 20,
        changeover_minutes: 10,
        material_wait_minutes: 10,
        idle_minutes: 10,
        ideal_cycle_time: 4,
        total_output: 100,
        good_output: 96,
        source: "manual",
      });
      assert(shift.id, "补录班次失败");
      created.shiftLogIds.push(shift.id);
    }
    check("2 个班次补录成功", created.shiftLogIds.length === 2, created.shiftLogIds.length);
    const overview = await request("GET", `/api/oee/overview?instance_id=${instance.id}&days=30`);
    check("ISA-95 口径读到班次", Number(overview.data && overview.data.shifts) >= 2, overview.data && overview.data.shifts);
    check("可用率 > 0", Number(overview.oee && overview.oee.availability) > 0, overview.oee && overview.oee.availability);
    check("OEE 在合理区间（0~1）", Number(overview.oee && overview.oee.oee) > 0 && Number(overview.oee.oee) <= 1, overview.oee && overview.oee.oee);
    const mainOee = await request("GET", `/api/equipment/oee?days=30&start_date=${shiftDates[1]}`);
    check("主 OEE 视图口径为班次×人数", mainOee.capacity_basis === "shift_workers", mainOee.capacity_basis);
    check("主 OEE 窗口为显式历史", mainOee.window && mainOee.window.mode === "explicit", mainOee.window);
  });

  // ---------------------------------------------------------------- 8. 资源视图联动
  await step("8. 多项目资源平衡（演练数据可见）", async (check) => {
    const planned = await request("GET", `/api/equipment_instances/${instance.id}/process_tree`);
    const first = planned.flat.find((row) => row.planned_start);
    const startDate = String(first.planned_start).slice(0, 10);
    const resource = await request("GET", `/api/resources/gantt?start_date=${startDate}&days=30&include_completed=1`);
    const hit = (resource.items || []).some((item) => item.instance_code === INSTANCE_CODE);
    check("资源视图包含演练项目任务", hit, { items: (resource.items || []).length, startDate });
    check("资源视图无 fatal 错误", Boolean(resource.summary), resource.summary);
  });

  // ---------------------------------------------------------------- 汇总
  const failed = results.filter((row) => !row.ok);
  const totalChecks = results.reduce((sum, row) => sum + row.checks.length, 0);
  const passedChecks = results.reduce((sum, row) => sum + row.checks.filter((check) => check.ok).length, 0);
  console.log(`\n=== 验收结果：${results.length - failed.length}/${results.length} 步通过，${passedChecks}/${totalChecks} 项检查通过 ===`);

  if (!KEEP) cleanupCreated(instance.id);
  else console.log("[keep] 保留本次创建的演练数据（可用于演示）");

  const reportDir = path.join(ROOT, "logs", "acceptance");
  fs.mkdirSync(reportDir, { recursive: true });
  const report = {
    generated_at: new Date().toISOString(),
    instance: { id: instance.id, code: instance.instance_code, name: instance.instance_name },
    base_url: BASE_URL,
    keep: KEEP,
    summary: { steps: results.length, steps_passed: results.length - failed.length, checks: totalChecks, checks_passed: passedChecks, ok: failed.length === 0 },
    steps: results,
  };
  const jsonPath = path.join(reportDir, `e2e-${TS}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const mdLines = [
    `# 端到端验收报告（${instance.instance_code}）`,
    "",
    `- 生成时间：${report.generated_at}`,
    `- 服务地址：${BASE_URL}`,
    `- 结果：**${failed.length === 0 ? "通过" : "未通过"}**（${results.length - failed.length}/${results.length} 步，${passedChecks}/${totalChecks} 项检查）`,
    "",
    "| 步骤 | 结果 | 检查项 | 说明 |",
    "|---|---|---|---|",
    ...results.map((row) => `| ${row.name} | ${row.ok ? "✅" : "❌"} | ${row.checks.filter((check) => check.ok).length}/${row.checks.length} | ${row.error ? String(row.error).replace(/\|/g, "\\|").slice(0, 120) : ""} |`),
  ];
  for (const row of results) {
    mdLines.push("", `## ${row.ok ? "✅" : "❌"} ${row.name}`, "");
    for (const check of row.checks) mdLines.push(`- ${check.ok ? "✅" : "❌"} ${check.name}${check.detail === null ? "" : ` — \`${JSON.stringify(check.detail).slice(0, 160)}\``}`);
    if (row.error) mdLines.push(`- ❌ 失败原因：${row.error}`);
  }
  const mdPath = path.join(reportDir, `e2e-${TS}.md`);
  fs.writeFileSync(mdPath, mdLines.join("\n"));
  console.log(`报告：${jsonPath}\n      ${mdPath}`);

  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("验收脚本异常：", error.message);
  process.exitCode = 1;
});
