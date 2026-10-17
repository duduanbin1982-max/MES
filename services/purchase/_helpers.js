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

function inferCategory(row) {
  const text = `${row.supplier_code || ''} ${row.supplier_name || ''} ${row.notes || ''}`.toLowerCase();
  if (/外协|加工|热处理|喷涂|outsourc|machine|coating|heat/.test(text)) return 'outsourcing';
  if (/标准|紧固|螺栓|轴承|密封|standard|bearing|bolt/.test(text)) return 'standard_part';
  if (/关键|主轴承|刀盘|液压|电气|key|critical|hydraulic/.test(text)) return 'key_component';
  if (/钢|板材|型材|原材料|焊材|raw|steel/.test(text)) return 'raw_material';
  return 'general';
}

module.exports = {
  inferCategory, makeHelpers, nextPoNo }

