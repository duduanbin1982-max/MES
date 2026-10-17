"use strict";
const { ApiError } = require('../app/errors');
// services/erpService.js
const { wrap } = require("../middleware/asyncHandler");
// P2-1 ERP Integration: GL account mapping + Cost ledger + ERP export
const fs = require("fs");
const path = require("path");

const logger = require("../app/logger").createLogger("erpService");

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS erp_gl_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_code TEXT NOT NULL UNIQUE,
      account_name TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'expense',
      parent_code TEXT, description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS erp_cost_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_no TEXT NOT NULL UNIQUE,
      entry_date TEXT NOT NULL DEFAULT (date('now')),
      gl_account_code TEXT NOT NULL,
      equipment_instance_id INTEGER, work_order_id INTEGER,
      purchase_order_id INTEGER, material_id INTEGER,
      description TEXT,
      debit_amount REAL NOT NULL DEFAULT 0,
      credit_amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      source_type TEXT NOT NULL, source_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      exported_at TEXT, erp_ref TEXT, notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS erp_export_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      export_type TEXT NOT NULL,
      record_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'success',
      file_path TEXT, error_message TEXT, exported_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS erp_sync_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT NOT NULL UNIQUE,
      config_value TEXT, description TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_erp_ledger_date ON erp_cost_ledger(entry_date);
    CREATE INDEX IF NOT EXISTS idx_erp_ledger_status ON erp_cost_ledger(status);
    CREATE INDEX IF NOT EXISTS idx_erp_ledger_inst ON erp_cost_ledger(equipment_instance_id);
    CREATE INDEX IF NOT EXISTS idx_erp_ledger_gl ON erp_cost_ledger(gl_account_code);
    INSERT OR IGNORE INTO erp_sync_config (config_key, config_value, description) VALUES
      ('export_format','csv','ERP export format'),
      ('export_path','/tmp/erp-exports','ERP export directory'),
      ('gl_auto_post','true','Auto-create ledger entries on PO receipt'),
      ('currency_default','CNY','Default currency');
    INSERT OR IGNORE INTO erp_gl_accounts (account_code,account_name,account_type,description) VALUES
      ('5001','原材料','expense','直接材料成本'),
      ('5002','外购成品','expense','外购成品/部件'),
      ('5003','外协加工费','expense','外协加工'),
      ('5004','直接人工','expense','生产工人工资'),
      ('5005','制造费用','expense','间接制造费用'),
      ('5006','设备折旧','expense','生产设备折旧'),
      ('1403','原材料库存','asset','原材料存货'),
      ('1405','在产品','asset','WIP在产品'),
      ('1407','产成品','asset','成品库存');
  `);
}

function makeHelpers(db) {
  return {
    all: (sql, p) => db.prepare(sql).all(...(p||[])),
    get: (sql, p) => db.prepare(sql).get(...(p||[])),
    run: (sql, p) => db.prepare(sql).run(...(p||[])),
  };
}

function nextEntryNo(db) {
  const r = db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(entry_no,4) AS INTEGER)),0)+1 AS n FROM erp_cost_ledger").get();
  return "JE" + String(r.n).padStart(8,"0");
}

function registerGlAccounts(app, db) {
  const { all, get, run } = makeHelpers(db);
  app.get("/api/erp/gl-accounts", wrap((req, res) => {
    res.json(all("SELECT * FROM erp_gl_accounts WHERE is_active=1 ORDER BY account_code"));
  }));
  app.get("/api/erp/gl-accounts/:id", wrap((req, res) => {
    const row = get("SELECT * FROM erp_gl_accounts WHERE id=?", [req.params.id]);
    if (!row) throw ApiError.notFound("GL account not found")
    res.json(row);
  }));
  app.post("/api/erp/gl-accounts", wrap((req, res) => {
    const { account_code, account_name, account_type, parent_code, description } = req.body;
    if (!account_code || !account_name) throw ApiError.validation("account_code and account_name required")
    const r = run("INSERT INTO erp_gl_accounts (account_code,account_name,account_type,parent_code,description) VALUES (?,?,?,?,?)",
      [account_code, account_name, account_type||"expense", parent_code||null, description||null]);
    res.json({ id: r.lastInsertRowid, account_code });
  }));
  app.put("/api/erp/gl-accounts/:id", wrap((req, res) => {
    const { account_name, account_type, parent_code, description, is_active } = req.body;
    run("UPDATE erp_gl_accounts SET account_name=COALESCE(?,account_name), account_type=COALESCE(?,account_type), parent_code=COALESCE(?,parent_code), description=COALESCE(?,description), is_active=COALESCE(?,is_active), updated_at=datetime('now') WHERE id=?",
      [account_name||null, account_type||null, parent_code||null, description||null, is_active!==undefined?is_active:null, req.params.id]);
    res.json({ success: true });
  }));
}

function registerLedger(app, db) {
  const { all, get, run } = makeHelpers(db);
  app.get("/api/erp/ledger", wrap((req, res) => {
    const { instance_id, status, start_date, end_date, gl_account } = req.query;
    let sql = "SELECT * FROM erp_cost_ledger WHERE 1=1";
    const p = [];
    if (instance_id) { sql += " AND equipment_instance_id=?"; p.push(instance_id); }
    if (status) { sql += " AND status=?"; p.push(status); }
    if (start_date) { sql += " AND entry_date>=?"; p.push(start_date); }
    if (end_date) { sql += " AND entry_date<=?"; p.push(end_date); }
    if (gl_account) { sql += " AND gl_account_code=?"; p.push(gl_account); }
    sql += " ORDER BY entry_date DESC, id DESC LIMIT 500";
    res.json(all(sql, p));
  }));
  app.get("/api/erp/ledger/summary", wrap((req, res) => {
    const { instance_id, start_date, end_date } = req.query;
    let sql = "SELECT gl_account_code, SUM(debit_amount) AS total_debit, SUM(credit_amount) AS total_credit, COUNT(*) AS entry_count FROM erp_cost_ledger WHERE 1=1";
    const p = [];
    if (instance_id) { sql += " AND equipment_instance_id=?"; p.push(instance_id); }
    if (start_date) { sql += " AND entry_date>=?"; p.push(start_date); }
    if (end_date) { sql += " AND entry_date<=?"; p.push(end_date); }
    sql += " GROUP BY gl_account_code ORDER BY gl_account_code";
    const rows = all(sql, p);
    let td=0, tc=0;
    rows.forEach(r => { td+=r.total_debit; tc+=r.total_credit; });
    res.json({ accounts: rows, total_debit: td, total_credit: tc, net: td-tc });
  }));
  app.get("/api/erp/ledger/:id", wrap((req, res) => {
    const row = get("SELECT * FROM erp_cost_ledger WHERE id=?", [req.params.id]);
    if (!row) throw ApiError.notFound("Ledger entry not found")
    res.json(row);
  }));
  app.post("/api/erp/ledger", wrap((req, res) => {
    const { gl_account_code, equipment_instance_id, work_order_id, purchase_order_id, material_id, description, debit_amount, credit_amount, source_type, source_id, notes } = req.body;
    if (!gl_account_code || !source_type) throw ApiError.validation("gl_account_code and source_type required")
    const eno = nextEntryNo(db);
    const r = run("INSERT INTO erp_cost_ledger (entry_no,gl_account_code,equipment_instance_id,work_order_id,purchase_order_id,material_id,description,debit_amount,credit_amount,source_type,source_id,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [eno, gl_account_code, equipment_instance_id||null, work_order_id||null, purchase_order_id||null, material_id||null, description||null, debit_amount||0, credit_amount||0, source_type, source_id||null, notes||null]);
    res.json({ id: r.lastInsertRowid, entry_no: eno });
  }));
}

function registerExport(app, db) {
  const { all, get, run } = makeHelpers(db);
  const edir = "/tmp/erp-exports";
  function ensureDir() { if (!fs.existsSync(edir)) fs.mkdirSync(edir, { recursive: true }); }

  app.post("/api/erp/export/ledger", wrap((req, res) => {
    ensureDir();
    const { start_date, end_date, instance_id } = req.body;
    let sql = "SELECT * FROM erp_cost_ledger WHERE status='pending'";
    const p = [];
    if (start_date) { sql += " AND entry_date>=?"; p.push(start_date); }
    if (end_date) { sql += " AND entry_date<=?"; p.push(end_date); }
    if (instance_id) { sql += " AND equipment_instance_id=?"; p.push(instance_id); }
    sql += " ORDER BY entry_date, id";
    const rows = all(sql, p);
    const ts = new Date().toISOString().replace(/[:.]/g,"-");
    const fp = path.join(edir, "ledger-"+ts+".json");
    fs.writeFileSync(fp, JSON.stringify(rows, null, 2));
    if (rows.length > 0) run("UPDATE erp_cost_ledger SET status='exported', exported_at=datetime('now') WHERE id IN (" + rows.map(r=>r.id).join(",") + ")");
    run("INSERT INTO erp_export_log (export_type,record_count,file_path) VALUES (?,?,?)",["ledger",rows.length,fp]);
    res.json({ exported: rows.length, file: fp });
  }));

  app.post("/api/erp/export/purchase-orders", wrap((req, res) => {
    ensureDir();
    const { start_date, end_date, status } = req.body;
    let sql = "SELECT po.*, s.supplier_name FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id=s.id WHERE 1=1";
    const p = [];
    if (start_date) { sql += " AND po.ordered_date>=?"; p.push(start_date); }
    if (end_date) { sql += " AND po.ordered_date<=?"; p.push(end_date); }
    if (status) { sql += " AND po.status=?"; p.push(status); }
    sql += " ORDER BY po.id";
    const rows = all(sql, p);
    const ts = new Date().toISOString().replace(/[:.]/g,"-");
    const fp = path.join(edir, "po-"+ts+".json");
    fs.writeFileSync(fp, JSON.stringify(rows, null, 2));
    run("INSERT INTO erp_export_log (export_type,record_count,file_path) VALUES (?,?,?)",["purchase_orders",rows.length,fp]);
    res.json({ exported: rows.length, file: fp });
  }));

  app.get("/api/erp/export/log", wrap((req, res) => {
    res.json(all("SELECT * FROM erp_export_log ORDER BY id DESC LIMIT 50"));
  }));
}

function registerCostRollup(app, db) {
  const { all, get, run } = makeHelpers(db);
  app.post("/api/erp/cost-rollup", wrap((req, res) => {
    const { instance_id } = req.body;
    if (!instance_id) throw ApiError.validation("instance_id required")
    const entries = [];

    // 1. 直接材料 (5001) — PO 已收货
    const poLines = all("SELECT pl.*, po.po_no, m.material_name, m.material_code FROM po_lines pl JOIN purchase_orders po ON pl.po_id=po.id JOIN materials m ON pl.material_id=m.id WHERE po.equipment_instance_id=? AND po.status IN ('received','partially_received')", [instance_id]);
    poLines.forEach(line => {
      entries.push({ gl_account_code:"5001", equipment_instance_id:instance_id, purchase_order_id:line.po_id, material_id:line.material_id, description:"[PO:"+line.po_no+"] "+line.material_name+" x"+line.quantity, debit_amount:line.line_amount, credit_amount:0, source_type:"purchase_order", source_id:line.po_id });
    });

    // 2. 外协加工费 (5003) — material_code 含 "WG" 前缀或 material_name 含 "外协"
    const outsourced = poLines.filter(l => (l.material_code||'').startsWith('WG') || (l.material_name||'').includes('外协'));
    outsourced.forEach(line => {
      entries.push({ gl_account_code:"5003", equipment_instance_id:instance_id, purchase_order_id:line.po_id, material_id:line.material_id, description:"[外协] [PO:"+line.po_no+"] "+line.material_name+" x"+line.quantity, debit_amount:line.line_amount, credit_amount:0, source_type:"outsourcing", source_id:line.po_id });
    });

    // 3. 直接人工 (5004) — 已完成工单 × 标准工时费
    const wos = all("SELECT * FROM work_orders WHERE equipment_instance_id=? AND status='completed'", [instance_id]);
    wos.forEach(wo => {
      const h = wo.actual_hours || 0;
      const lc = h * 50;
      if (lc > 0) entries.push({ gl_account_code:"5004", equipment_instance_id:instance_id, work_order_id:wo.id, description:"[WO:"+(wo.wo_no||wo.id)+"] 直接人工 "+h+"h", debit_amount:lc, credit_amount:0, source_type:"work_order", source_id:wo.id });
    });

    // 4. 设备折旧 (5006) — 合同金额 / 预计生命周期(月) * 当月占比
    const eq = get("SELECT * FROM equipment_instances WHERE id=?", [instance_id]);
    if (eq && eq.contract_amount) {
      const lifecycleMonths = 24; // 默认 24 个月生命周期
      const monthlyDepreciation = eq.contract_amount / lifecycleMonths;
      const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
      const dayOfMonth = new Date().getDate();
      const prorated = monthlyDepreciation * (dayOfMonth / daysInMonth);
      entries.push({ gl_account_code:"5006", equipment_instance_id:instance_id, description:"[折旧] "+eq.instance_name+" 设备折旧 (合同额:"+Math.round(eq.contract_amount)+" / "+lifecycleMonths+"月)", debit_amount:Math.round(prorated*100)/100, credit_amount:0, source_type:"depreciation", source_id:instance_id });
    }

    // 5. 制造费用 (5005) — 外协+折旧之外的间接费用，按人工 20% 估算
    const laborTotal = entries.filter(e=>e.gl_account_code==="5004").reduce((s,e)=>s+e.debit_amount,0);
    if (laborTotal > 0) {
      entries.push({ gl_account_code:"5005", equipment_instance_id:instance_id, description:"[制造费用] 间接费用 (人工×20%)", debit_amount:Math.round(laborTotal*0.2*100)/100, credit_amount:0, source_type:"overhead", source_id:instance_id });
    }

    let count = 0;
    const ins = db.prepare("INSERT INTO erp_cost_ledger (entry_no,gl_account_code,equipment_instance_id,work_order_id,purchase_order_id,material_id,description,debit_amount,credit_amount,source_type,source_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const tx = db.transaction(() => { entries.forEach(e => { ins.run(nextEntryNo(db), e.gl_account_code, e.equipment_instance_id, e.work_order_id||null, e.purchase_order_id||null, e.material_id||null, e.description, e.debit_amount, e.credit_amount, e.source_type, e.source_id||null); count++; }); });
    tx();
    res.json({ instance_id, entries_created:count, total_debit:Math.round(entries.reduce((s,e)=>s+e.debit_amount,0)*100)/100, breakdown:{ material:entries.filter(e=>e.gl_account_code==="5001").length, outsourcing:entries.filter(e=>e.gl_account_code==="5003").length, labor:entries.filter(e=>e.gl_account_code==="5004").length, depreciation:entries.filter(e=>e.gl_account_code==="5006").length, overhead:entries.filter(e=>e.gl_account_code==="5005").length } });
  }));
}

function register(app, db) {
  runMigration(db);
  registerGlAccounts(app, db);
  registerLedger(app, db);
  registerExport(app, db);
  registerCostRollup(app, db);
  logger.info("[erpService] ERP integration registered (GL + Ledger + Export + CostRollup)");
}

module.exports = { register };