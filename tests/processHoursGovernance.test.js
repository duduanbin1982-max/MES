'use strict';

/**
 * processHoursGovernance.test.js
 * 2026-11-06 工时与报工模块审计 + P3 遗留治理验证：
 *   WH-1 报工校验 / WH-2 撤销重算 / WH-3 定额校验 / WH-3' 绩效公式
 *   WH-5 完工进度 / WH-6 节点去重
 *   P3：审批流（pending→approved/rejected）、成本自动入账与冲销、
 *       月结锁定、日历加班、历史 worker_id 回填
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT)`);
  db.exec(`CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT)`);
  db.exec(`CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, operation_name TEXT, estimated_hours REAL, operation_type TEXT, status TEXT DEFAULT 'pending', phase_code TEXT)`);
  db.exec(`CREATE TABLE work_orders (id INTEGER PRIMARY KEY, wo_code TEXT, title TEXT, equipment_instance_id INTEGER, assigned_to INTEGER, actual_hours REAL, updated_at TEXT)`);
  db.exec(`CREATE TABLE work_order_operations (id INTEGER PRIMARY KEY, work_order_id INTEGER, action TEXT)`);
  db.exec(`CREATE TABLE process_executions (id INTEGER PRIMARY KEY, process_node_id INTEGER, operator_id INTEGER, action TEXT, hours_worked REAL, timestamp TEXT)`);
  db.exec(`CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT)`);
  db.exec(`CREATE TABLE project_cost_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER NOT NULL, bom_node_id INTEGER, work_order_id INTEGER, cost_type TEXT NOT NULL, source_type TEXT, source_ref TEXT, description TEXT NOT NULL, vendor TEXT, amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'CNY', occurred_on TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'posted', notes TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT)`);
  db.exec(`CREATE TABLE work_month_locks (month TEXT PRIMARY KEY, locked_at TEXT DEFAULT CURRENT_TIMESTAMP, locked_by INTEGER, note TEXT)`);
  db.exec(`CREATE TABLE work_calendar (date TEXT PRIMARY KEY, day_type TEXT NOT NULL DEFAULT 'workday', daily_hours REAL NOT NULL DEFAULT 8, note TEXT, updated_at TEXT)`);
  db.exec(`CREATE TABLE process_standard_hours (id INTEGER PRIMARY KEY AUTOINCREMENT, process_node_id INTEGER NOT NULL, work_type TEXT NOT NULL DEFAULT 'assembly', standard_hours REAL NOT NULL DEFAULT 0, worker_count INTEGER NOT NULL DEFAULT 1, unit TEXT DEFAULT 'h', description TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(process_node_id, work_type))`);
  db.exec(`CREATE TABLE work_report_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT, work_order_id INTEGER NOT NULL, operation_id INTEGER, process_node_id INTEGER,
    worker_id INTEGER, work_type TEXT NOT NULL DEFAULT 'assembly', hours_spent REAL NOT NULL DEFAULT 0,
    quantity_completed INTEGER DEFAULT 0, quantity_total INTEGER, completion_pct REAL, quality_result TEXT DEFAULT 'pass',
    start_time TEXT, end_time TEXT, workstation TEXT, notes TEXT, reported_by INTEGER,
    reported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'approved', approved_by INTEGER, approved_at TEXT, reject_reason TEXT)`);
  return db;
}

function makeRoutes(db) {
  const routes = {};
  const app = {
    get: (p, h) => { routes['GET ' + p] = h; },
    post: (p, h) => { routes['POST ' + p] = h; },
    put: (p, h) => { routes['PUT ' + p] = h; },
    delete: (p, h) => { routes['DELETE ' + p] = h; },
  };
  delete require.cache[require.resolve('../services/processHoursService')];
  require('../services/processHoursService').register(app, db, {});
  return routes;
}

function call(routes, method, fullPath, body, user) {
  const queryIndex = String(fullPath).indexOf('?');
  const path = queryIndex >= 0 ? String(fullPath).slice(0, queryIndex) : String(fullPath);
  const query = {};
  if (queryIndex >= 0) {
    for (const pair of String(fullPath).slice(queryIndex + 1).split('&')) {
      if (!pair) continue;
      const [key, value = ''] = pair.split('=');
      query[decodeURIComponent(key)] = decodeURIComponent(value);
    }
  }
  const handler = routes[method + ' ' + path];
  if (!handler) throw new Error('no route: ' + method + ' ' + path);
  const match = path.match(/:([a-zA-Z_]+)/g) || [];
  const params = {};
  if (match.length === 1) params[match[0].slice(1)] = body && body.__id ? body.__id : 1;
  const req = { body: body || {}, query, params, user: user || { uid: 7, role: 'worker' } };
  let status = 200;
  let json = null;
  const res = { status: (code) => { status = code; return res; }, json: (payload) => { json = payload; return res; } };
  handler(req, res, (error) => {
    if (!error) return;
    status = error.status || 500;
    json = { error: error.message, code: error.code || 'INTERNAL_ERROR' };
  });
  return { status, json };
}

let db;
let routes;
test.beforeEach(() => {
  db = freshDb();
  db.prepare(`INSERT INTO users (id, username, full_name) VALUES (7, 'w7', '张三'), (1, 'admin', '管理员')`).run();
  db.prepare(`INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (1, 'TBM-1', '一号机'), (2, 'TBM-2', '二号机')`).run();
  db.prepare(`INSERT INTO process_nodes (id, equipment_instance_id, operation_name, estimated_hours) VALUES (11, 1, '下料', 8), (12, 2, '焊接', 8)`).run();
  db.prepare(`INSERT INTO work_orders (id, wo_code, title, equipment_instance_id, assigned_to, actual_hours) VALUES (1, 'WO-1', '测试工单', 1, 7, 0)`).run();
  db.prepare(`INSERT INTO work_order_operations (id, work_order_id, action) VALUES (5, 1, 'start')`).run();
  db.prepare(`INSERT INTO system_settings (key, value) VALUES ('labor_rate_per_hour', '200')`).run();
  routes = makeRoutes(db);
});

function localMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function costRows(reportId) {
  return db.prepare("SELECT * FROM project_cost_entries WHERE source_ref = ?").all('work_report:' + reportId + ':labor');
}

function approve(id) {
  return call(routes, 'PUT', '/api/work-reports/:id/approve', { __id: id }, { uid: 1, role: 'admin' });
}

// ---------------- 基础校验 ----------------

test('WH-1a 报工参数校验：负/0/超 24 小时、工单不存在均拒绝', () => {
  assert.equal(call(routes, 'POST', '/api/work-reports', { work_order_id: 1, hours_spent: -3 }).status, 400);
  assert.equal(call(routes, 'POST', '/api/work-reports', { work_order_id: 1, hours_spent: 0 }).status, 400);
  assert.equal(call(routes, 'POST', '/api/work-reports', { work_order_id: 1, hours_spent: 25 }).status, 400);
  assert.equal(call(routes, 'POST', '/api/work-reports', { work_order_id: 999, hours_spent: 1 }).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM work_report_details').get().c, 0);
});

test('WH-1b 工序必须属于工单实例；数量/完成率校验；新报工默认 pending 不计入实际工时', () => {
  assert.equal(call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 12, hours_spent: 2 }).status, 400);
  assert.equal(call(routes, 'POST', '/api/work-reports', { work_order_id: 1, quantity_completed: 5, quantity_total: 4, hours_spent: 2 }).status, 400);
  const result = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 11, hours_spent: 4, quantity_completed: 6, quantity_total: 8 });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.status, 'pending');
  const row = db.prepare('SELECT * FROM work_report_details WHERE id = ?').get(result.json.id);
  assert.equal(row.worker_id, 7);
  assert.equal(row.completion_pct, 75);
  assert.equal(db.prepare('SELECT actual_hours FROM work_orders WHERE id = 1').get().actual_hours, 0, '待审批不计入');
  assert.equal(costRows(result.json.id).length, 0, '待审批不入成本');
});

test('WH-2 审批通过：计入实际工时 + 自动生成人工成本；驳回/撤销冲销', () => {
  const report = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 11, hours_spent: 4 });
  const approved = approve(report.json.id);
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  assert.equal(approved.json.status, 'approved');
  assert.equal(approved.json.actual_hours, 4);
  const costs = costRows(report.json.id);
  assert.equal(costs.length, 1);
  assert.equal(costs[0].amount, 800, '4h × 200 元/h');
  assert.equal(costs[0].cost_type, 'labor');
  const again = approve(report.json.id);
  assert.equal(again.json.already, true);
  assert.equal(costRows(report.json.id).length, 1, '重复审批不重复入账');

  const removed = call(routes, 'DELETE', '/api/work-reports/:id', { __id: report.json.id });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.actual_hours, 0);
  assert.equal(costRows(report.json.id).length, 0, '撤销后成本冲销');
});

test('WH-2b 驳回：必须填原因，不计工时且冲销成本', () => {
  const report = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 11, hours_spent: 3 });
  approve(report.json.id);
  assert.equal(costRows(report.json.id).length, 1);
  assert.equal(call(routes, 'PUT', '/api/work-reports/:id/reject', { __id: report.json.id }).status, 400, '驳回原因必填');
  const rejected = call(routes, 'PUT', '/api/work-reports/:id/reject', { __id: report.json.id, reason: '工时填写有误' });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.json));
  assert.equal(rejected.json.status, 'rejected');
  assert.equal(rejected.json.actual_hours, 0);
  assert.equal(costRows(report.json.id).length, 0);
});

test('WH-3 工时定额校验 + WH-6 节点去重', () => {
  assert.equal(call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 'undefined', work_type: 'assembly', standard_hours: 2 }).status, 400);
  assert.equal(call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 999, work_type: 'assembly', standard_hours: 2 }).status, 404);
  assert.equal(call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 11, work_type: 'assembly', standard_hours: 0 }).status, 400);
  assert.equal(call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 11, work_type: 'assembly', standard_hours: 8, worker_count: 2 }).status, 200);
  assert.equal(call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 11, work_type: 'welding', standard_hours: 4 }).status, 200);
  const summary = call(routes, 'GET', '/api/process/hours-summary?instance_id=1', {});
  assert.equal(summary.json.nodes, 1);
  assert.equal(summary.json.total_man_hours, 20, '8×2 + 4×1');
});

test("WH-3' 绩效只统计 approved，标准工时取定额", () => {
  call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 11, work_type: 'assembly', standard_hours: 4, worker_count: 1 });
  const report = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 11, hours_spent: 2 });
  let perf = call(routes, 'GET', '/api/process-hours/worker-performance?from=2020-01-01&to=2030-01-01', {});
  assert.equal(perf.json.workers.length, 0, '待审批不计入绩效');
  approve(report.json.id);
  perf = call(routes, 'GET', '/api/process-hours/worker-performance?from=2020-01-01&to=2030-01-01', {});
  const worker = perf.json.workers.find((row) => row.user_id === 7);
  assert.equal(worker.standard_hours, 4);
  assert.equal(worker.efficiency_pct, 200);
  assert.equal(perf.json.summary.avg_efficiency, 200);
});

test('WH-5 完工进度：只统计 approved，优先数量口径', () => {
  call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 11, work_type: 'assembly', standard_hours: 8 });
  const report = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 11, hours_spent: 4, quantity_completed: 6, quantity_total: 8 });
  let progress = call(routes, 'GET', '/api/process/nodes/:id/progress', { __id: 11 });
  assert.equal(progress.json.completion_pct, 0, '待审批不计入');
  assert.equal(progress.json.pending_reports, 1);
  approve(report.json.id);
  progress = call(routes, 'GET', '/api/process/nodes/:id/progress', { __id: 11 });
  assert.equal(progress.json.completion_pct, 75);
  assert.equal(progress.json.hours_ratio_pct, 50);
  assert.equal(progress.json.pending_reports, 0);
});

// ---------------- P3 遗留治理 ----------------

test('P3-1 月结锁定：锁定月禁止新增/审批/撤销，解锁恢复', () => {
  const month = localMonth();
  const locked = call(routes, 'POST', '/api/work-report-locks', { month, note: '月末结算' });
  assert.equal(locked.status, 200);
  const report = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 11, hours_spent: 2 });
  assert.equal(report.status, 400, '锁定月不能新增报工');

  db.prepare("DELETE FROM work_month_locks WHERE month=?").run(month);
  const pending = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 11, hours_spent: 2 });
  assert.equal(pending.status, 200);
  call(routes, 'POST', '/api/work-report-locks', { month });
  assert.equal(approve(pending.json.id).status, 400, '锁定月不能审批');
  assert.equal(call(routes, 'DELETE', '/api/work-reports/:id', { __id: pending.json.id }).status, 200, '待审批报工可删除');
  const unlock = call(routes, 'DELETE', '/api/work-report-locks/:month', { __id: month });
  assert.equal(unlock.status, 200);
  const locks = call(routes, 'GET', '/api/work-report-locks', {});
  assert.ok(!locks.json.locked_months.includes(month));
});

test('P3-2 加班日历：周末/节假日阈值 0，工作日默认 8h', () => {
  db.prepare(`INSERT INTO work_report_details (work_order_id, process_node_id, worker_id, work_type, hours_spent, quantity_completed, quality_result, reported_at, status)
              VALUES (1, 11, 7, 'assembly', 2, 0, 'pass', '2026-11-07 10:00:00', 'approved')`).run(); // 周六
  db.prepare(`INSERT INTO work_report_details (work_order_id, process_node_id, worker_id, work_type, hours_spent, quantity_completed, quality_result, reported_at, status)
              VALUES (1, 11, 7, 'assembly', 12, 0, 'pass', '2026-11-09 10:00:00', 'approved')`).run(); // 周一
  call(routes, 'POST', '/api/work-calendar', { date: '2026-11-09', day_type: 'holiday', daily_hours: 0 });
  const overtime = call(routes, 'GET', '/api/process-hours/overtime?from=2026-11-01&to=2026-11-30', {});
  assert.equal(overtime.status, 200);
  const weekend = overtime.json.records.find((row) => row.date === '2026-11-07');
  const holiday = overtime.json.records.find((row) => row.date === '2026-11-09');
  assert.equal(weekend.day_type, 'weekend');
  assert.equal(weekend.overtime_hours, 2, '周末 2h 全部算加班');
  assert.equal(holiday.day_type, 'holiday');
  assert.equal(holiday.overtime_hours, 12, '节假日全部算加班');
  const workday = call(routes, 'GET', '/api/process-hours/overtime?from=2026-11-10&to=2026-11-10', {});
  assert.equal(workday.json.records.length, 0);
});

test('P3-3 历史 worker_id 回填：reported_by → 工单 assigned_to', () => {
  const { planWorkerBackfill, applyPlan } = require('../scripts/migrate-work-hours-governance');
  db.prepare(`INSERT INTO work_report_details (work_order_id, process_node_id, worker_id, work_type, hours_spent, reported_by, reported_at, status)
              VALUES (1, 11, NULL, 'assembly', 1, 1, '2026-06-01 10:00:00', 'approved')`).run();
  db.prepare(`INSERT INTO work_report_details (work_order_id, process_node_id, worker_id, work_type, hours_spent, reported_by, reported_at, status)
              VALUES (1, 11, NULL, 'assembly', 1, NULL, '2026-06-02 10:00:00', 'approved')`).run();
  const plan = planWorkerBackfill(db);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].worker_id, 1, '优先 reported_by');
  assert.equal(plan[1].worker_id, 7, '回退工单 assigned_to');
  applyPlan(db, [], plan);
  const rows = db.prepare('SELECT worker_id FROM work_report_details ORDER BY id').all();
  assert.deepEqual(rows.map((row) => row.worker_id), [1, 7]);
});

test('P3-4 工时口径统一：项目进度优先取已审批报工，无报工回退工序执行工时', () => {
  const { getProcessProgress } = require('../services/process/progress');
  const runProgress = () => {
    let payload = null;
    const res = { json: (value) => { payload = value; }, status: () => res };
    getProcessProgress({ params: { id: 1 }, query: {} }, res, db, 1);
    return payload;
  };
  db.prepare("INSERT INTO process_executions (process_node_id, operator_id, action, hours_worked, timestamp) VALUES (11, 7, 'complete', 12, '2026-06-01 10:00:00')").run();
  let progress = runProgress();
  assert.equal(progress.hours.actual_basis, 'process_executions', '没有报工取执行工时');
  assert.equal(progress.hours.actual, 12);

  const report = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 11, hours_spent: 3 });
  approve(report.json.id);
  progress = runProgress();
  assert.equal(progress.hours.actual_basis, 'work_reports', '有已审批报工后取报工');
  assert.equal(progress.hours.actual, 3);
});
