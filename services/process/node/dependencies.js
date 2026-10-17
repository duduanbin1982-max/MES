"use strict";
// services/process/node/dependencies.js
// 工艺依赖管理 (2 个端点)
//   POST   /api/process_dependencies          新增依赖 (FS/SS/FF/SF)
//   DELETE /api/process_dependencies/:id      删除依赖
// Author: 三狗子 | Date: 2026-06-24

const { run, wrap } = require("./_helpers");

function register(app, db) {
app.post('/api/process_dependencies', wrap((req, res) => {
  const { equipment_instance_id, predecessor_id, successor_id, dep_type, lag_hours } = req.body;
  if (!equipment_instance_id || !predecessor_id || !successor_id) return res.status(400).json({ error: '必填' });
  const r = run( db, 
    "INSERT INTO process_dependencies (equipment_instance_id, predecessor_id, successor_id, dep_type, lag_hours) VALUES (?, ?, ?, ?, ?)",
    [equipment_instance_id, predecessor_id, successor_id, dep_type || 'FS', lag_hours || 0]
  );
  res.json({ id: r.lastInsertRowid, message: '依赖已创建' });
}));


app.delete('/api/process_dependencies/:id', wrap((req, res) => {
  const r = run( db, 'DELETE FROM process_dependencies WHERE id = ?', req.params.id);
  res.json({ changes: r.changes });
}));


}

module.exports = { register };
