// services/purchase/_helpers.js
// 采购 service 共享: 工厂函数 + po_no 生成 + 状态机
// Author: 三狗子 | Date: 2026-06-25

function makeHelpers(db) {
  const all = (sql, p = []) => db.prepare(sql).all(p)
  const get = (sql, p = []) => db.prepare(sql).get(p)
  const run = (sql, p = []) => db.prepare(sql).run(p)
  const wrap = (h) => (req, res) => {
    try { h(req, res) }
    catch (e) { console.error(e); res.status(500).json({ error: e.message }) }
  }
  return { all, get, run, wrap }
}

// 生成下一个 PO 号: PO-YYYY-NNN
function nextPoNo(db) {
  const year = new Date().getFullYear()
  const prefix = 'PO-' + year + '-'
  const row = db.prepare("SELECT po_no FROM purchase_orders WHERE po_no LIKE ? ORDER BY po_no DESC LIMIT 1").get(prefix + '%')
  let n = 1
  if (row) {
    n = parseInt(row.po_no.slice(prefix.length), 10) + 1
  }
  return prefix + String(n).padStart(3, '0')
}

module.exports = { makeHelpers, nextPoNo }