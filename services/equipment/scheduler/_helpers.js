// 排程 service 共享 helper: 工厂函数 + 时间工具

const logger = require("../../../app/logger").createLogger("equipment/scheduler");

function makeHelpers(db) {
  const all = (sql, params = []) => db.prepare(sql).all(params)
  const get = (sql, params = []) => db.prepare(sql).get(params)
  const run = (sql, params = []) => db.prepare(sql).run(params)
  const wrap = (handler) => (req, res) => {
    try { handler(req, res) }
    catch (e) { logger.error(e); res.status(500).json({ error: e.message }) }
  }
  return { all, get, run, wrap }
}

// 解析日期字符串为 Date, 强制按 UTC 解读 (与部署时区无关)
//   'YYYY-MM-DD'           -> 'YYYY-MM-DD T00:00:00Z'
//   'YYYY-MM-DD HH:MM:SS'  -> 'YYYY-MM-DD HH:MM:SSZ'
//   含 Z 或时区: 原样
//   带多余引号: 自动 trim (兼容测试 mock 或脏数据)
//   无法解析: 返回 null (调用方需自行 fallback)
function parseDateUtc(s) {
  if (s == null) return null
  let v = String(s).trim().replace(/^['"]+|['"]+$/g, '')
  if (!v) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v = v + 'T00:00:00Z'
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) v = v + 'Z'
  const d = new Date(v)
  if (isNaN(d.getTime())) return null
  return d
}

// 把 ISO/YYYY-MM-DD 加 N 小时, 返回 YYYY-MM-DD HH:MM:SS (UTC)
// 与部署时区无关: 统一按 UTC 解读
function addHours(isoOrDate, hours) {
  if (!hours) hours = 0
  const d = parseDateUtc(isoOrDate)
  if (!d) {
    // 兜底: 解析失败时返回原值加占位
    return String(isoOrDate || '').replace(/^['"]+|['"]+$/g, '')
  }
  d.setTime(d.getTime() + hours * 3600 * 1000)
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

// 取 max(a, b) (字符串日期可直接比较)
function maxDate(a, b) {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

module.exports = { makeHelpers, addHours, maxDate, parseDateUtc }
