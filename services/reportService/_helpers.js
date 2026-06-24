// 报告 service 共享 helper: 工厂函数 (注册时绑定 db)
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

module.exports = { makeHelpers }