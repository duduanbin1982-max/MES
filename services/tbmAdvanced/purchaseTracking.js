// services/tbmAdvanced/purchaseTracking.js
// 从 tbmAdvanced.js 拆分 (brooks-audit R2)
'use strict';
const { ApiError } = require('../../app/errors');

const { wrap } = require('../../middleware/asyncHandler');

function registerRoutes(app, db) {
  const all = (sql, p) => db.prepare(sql).all(...(p||[]));
  const get = (sql, p) => db.prepare(sql).get(...(p||[]));
  const run = (sql, p) => db.prepare(sql).run(...(p||[]));
// ============================================================
  app.get('/api/purchase-tracking', wrap((req, res) => {
    const { status, overdue } = req.query;
    let sql = "SELECT pt.*, ei.instance_code FROM purchase_tracking pt LEFT JOIN purchase_orders po ON pt.purchase_order_id=po.id LEFT JOIN equipment_instances ei ON po.equipment_instance_id=ei.id WHERE 1=1";
    const p = [];
    if (status) { sql += ' AND pt.status=?'; p.push(status); }
    if (overdue==='1') { sql += " AND pt.planned_delivery < date('now') AND pt.status NOT IN ('delivered','cancelled')"; }
    sql += ' ORDER BY pt.planned_delivery ASC';
    res.json(all(sql, p));
  }));
  app.post('/api/purchase-tracking', wrap((req, res) => {
    const { purchase_order_id, item_name, supplier, order_date, planned_delivery, actual_delivery, status, urgent_tags, remarks } = req.body;
    const r = run("INSERT INTO purchase_tracking (purchase_order_id,item_name,supplier,order_date,planned_delivery,actual_delivery,delay_days,status,urgent_tags,remarks) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [purchase_order_id||null,item_name||null,supplier||null,order_date||null,planned_delivery||null,actual_delivery||null,
       planned_delivery ? Math.max(0, Math.floor((Date.now()/1000 - new Date(planned_delivery).getTime()/1000)/86400)) : 0,
       status||'pending',urgent_tags||null,remarks||null]);
    res.json({id:r.lastInsertRowid});
  }));
  app.put('/api/purchase-tracking/:id', wrap((req, res) => {
    const fields = ['purchase_order_id','item_name','supplier','order_date','planned_delivery','actual_delivery','status','urgent_tags','remarks'];
    const set=[]; const vals=[];
    for (const f of fields) if (req.body[f]!==undefined) { set.push(f+'=?'); vals.push(req.body[f]); }
    if (req.body.actual_delivery!==undefined||req.body.planned_delivery!==undefined) {
      set.push("delay_days=CASE WHEN actual_delivery IS NOT NULL AND planned_delivery IS NOT NULL THEN MAX(0,julianday(actual_delivery)-julianday(planned_delivery)) ELSE 0 END");
    }
    if (!set.length) throw ApiError.validation('no fields')
    set.push("updated_at=datetime('now')"); vals.push(req.params.id);
    run('UPDATE purchase_tracking SET '+set.join(',')+' WHERE id=?', vals);
    res.json({success:true});
  }));
  // 采购跟催统计
  app.get('/api/purchase-tracking/stats', wrap((req, res) => {
    const total = get("SELECT COUNT(*) c FROM purchase_tracking")?.c||0;
    const overdue = get("SELECT COUNT(*) c FROM purchase_tracking WHERE planned_delivery < date('now') AND status NOT IN ('delivered','cancelled')")?.c||0;
    const pending = get("SELECT COUNT(*) c FROM purchase_tracking WHERE status='pending'")?.c||0;
    const delivered = get("SELECT COUNT(*) c FROM purchase_tracking WHERE status='delivered'")?.c||0;
    res.json({total,overdue,pending,delivered});
  }));
}

module.exports = { registerRoutes };
