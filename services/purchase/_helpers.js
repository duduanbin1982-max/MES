// services/purchase/_helpers.js
// 采购 service 共享: 工厂函数 + po_no 生成 + 状态机
// Author: 三狗子 | Date: 2026-06-25

function makeHelpers(db) {
  const all = (sql, p = []) => db.prepare(sql).all(p)
  const get = (sql, p = []) => db.prepare(sql).get(p)
  const run = (sql, p = []) => db.prepare(sql).run(p)
  return { all, get, run }
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
  return prefix + String(n).padStart(3, "0") + "-" + String(Date.now()).slice(-3)
}

module.exports = { makeHelpers, nextPoNo }

