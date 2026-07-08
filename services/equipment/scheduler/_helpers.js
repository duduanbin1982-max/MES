// 排程 service 共享 helper: 工厂函数 + 时间工具
function makeHelpers(db) {
  const all = (sql, params = []) => db.prepare(sql).all(params)
  const get = (sql, params = []) => db.prepare(sql).get(params)
  const run = (sql, params = []) => db.prepare(sql).run(params)
  const wrap = (handler) => (req, res) => {
    try { handler(req, res) }
    catch (e) { console.error(e); res.status(500).json({ error: e.message }) }
  }
  return { all, get, run, wrap }
}

// 把 ISO/YYYY-MM-DD 加 N 小时, 返回 YYYY-MM-DD HH:MM:SS
function addHours(isoOrDate, hours) {
  if (!hours) hours = 0
  const d = new Date(isoOrDate)
  d.setTime(d.getTime() + hours * 3600 * 1000)
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

// 取 max(a, b) (字符串日期可直接比较)
function maxDate(a, b) {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

module.exports = { makeHelpers, addHours, maxDate }

