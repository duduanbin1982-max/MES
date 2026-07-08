// 报告 service 共享 helper: 工厂函数 (wrap 统一走 asyncHandler)
function makeHelpers(db) {
  const all = (sql, params = []) => db.prepare(sql).all(params)
  const get = (sql, params = []) => db.prepare(sql).get(params)
  const run = (sql, params = []) => db.prepare(sql).run(params)
  return { all, get, run }
}
module.exports = { makeHelpers }
