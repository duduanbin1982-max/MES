/**
 * processNodeSubsystem 单测
 *
 * 用 better-sqlite3 in-memory DB + mock req/res
 */

const path = require('path')
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))

let passed = 0, failed = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { console.log('  ✅', label); passed++ }
  else { console.log('  ❌', label, '\n     got:', JSON.stringify(got), '\n     want:', JSON.stringify(want)); failed++ }
}

// 用 in-memory DB 复制关键 schema
function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, subsystem_id INTEGER, updated_at TEXT);
    CREATE TABLE equipment_subsystems (id INTEGER PRIMARY KEY, code TEXT, name_zh TEXT);
    INSERT INTO equipment_subsystems VALUES (1, 'cutter', '刀盘'), (2, 'drive', '主驱动'), (3, 'shield', '盾体');
    INSERT INTO process_nodes VALUES (100, 1, 1, null), (101, 1, 2, null), (102, 1, null, null);
  `)
  return db
}

// Mock req/res
function makeReqRes(body = {}, params = {}) {
  const req = { body, params: { id: params.id || '100' } }
  let statusCode = 200, jsonBody = null
  const res = {
    status(code) { statusCode = code; return this },
    json(body) { jsonBody = body; return this },
    get _r() { return { statusCode, body: jsonBody } }
  }
  return { req, res, getResult: () => ({ statusCode, body: jsonBody }) }
}

// 加载 service（in-memory DB 时每次都 require fresh）
delete require.cache[require.resolve('../services/process/nodeSubsystem.js')]
const { patchNodeSubsystem } = require('../services/process/nodeSubsystem.js')

console.log('=== patchNodeSubsystem ===')
{
  const db = makeDb()
  // 1. 正常改：100 → subsystem_id=3
  const { req, res, getResult } = makeReqRes({ subsystem_id: 3 }, { id: '100' })
  patchNodeSubsystem(req, res, db)
  const r = getResult()
  eq('1. 正常改 → status 200', r.statusCode, 200)
  eq('1. ok=true', r.body.ok, true)
  eq('1. new subsystem_id', r.body.node.subsystem_id, 3)
  eq('1. new subsystem_name', r.body.node.subsystem_name, '盾体')
  eq('1. previous', r.body.previous_subsystem_id, 1)
  // DB 验证
  const updated = db.prepare('SELECT subsystem_id FROM process_nodes WHERE id = 100').get()
  eq('1. DB updated', updated.subsystem_id, 3)
}

{
  // 2. 改成 null（移到未分类）
  const db = makeDb()
  const { req, res, getResult } = makeReqRes({ subsystem_id: null }, { id: '101' })
  patchNodeSubsystem(req, res, db)
  const r = getResult()
  eq('2. 改 null → 200', r.statusCode, 200)
  eq('2. subsystem_id=null', r.body.node.subsystem_id, null)
  eq('2. subsystem_name=null', r.body.node.subsystem_name, null)
}

{
  // 3. node 不存在
  const db = makeDb()
  const { req, res, getResult } = makeReqRes({ subsystem_id: 3 }, { id: '999' })
  patchNodeSubsystem(req, res, db)
  const r = getResult()
  eq('3. 不存在 → 404', r.statusCode, 404)
}

{
  // 4. subsystem_id 不存在
  const db = makeDb()
  const { req, res, getResult } = makeReqRes({ subsystem_id: 999 }, { id: '100' })
  patchNodeSubsystem(req, res, db)
  const r = getResult()
  eq('4. subsystem 不存在 → 400', r.statusCode, 400)
}

{
  // 5. body 类型错（字符串）
  const db = makeDb()
  const { req, res, getResult } = makeReqRes({ subsystem_id: '3' }, { id: '100' })
  patchNodeSubsystem(req, res, db)
  const r = getResult()
  eq('5. 字符串 → 400', r.statusCode, 400)
}

{
  // 6. body 缺失
  const db = makeDb()
  const { req, res, getResult } = makeReqRes({}, { id: '100' })
  patchNodeSubsystem(req, res, db)
  const r = getResult()
  eq('6. 缺 body → 400', r.statusCode, 400)
}

{
  // 7. 跨实例改（不限制 instance_id — admin 可改任何节点）
  const db = makeDb()
  const { req, res, getResult } = makeReqRes({ subsystem_id: 2 }, { id: '102' })  // 102 在 instance=1
  patchNodeSubsystem(req, res, db)
  const r = getResult()
  eq('7. null → 2 = 200', r.statusCode, 200)
  eq('7. new sub=2', r.body.node.subsystem_id, 2)
  eq('7. previous=null', r.body.previous_subsystem_id, null)
}

console.log('=== 结果: ' + passed + ' passed, ' + failed + ' failed ===')
console.log("# pass " + passed)
console.log("# fail " + failed)
process.exit(failed > 0 ? 1 : 0)
