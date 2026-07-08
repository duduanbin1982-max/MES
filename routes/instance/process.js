// routes/instance/process.js
// 工艺树相关路由 — 从 instance.js 拆分 (brooks-audit R2)

const { generateProcessTree, getCriticalPath } = require('../../services/processTree/generator');
const { getSubsystems } = require('../../services/processTree/subsystems');
const { getMindmap } = require('../../services/processTree/mindmap');
const { getBreadcrumb } = require('../../services/processTree/breadcrumb');
const { getCrossSubsystemMatrix } = require('../../services/processTree/crossSubsystemDeps');
const { patchNodeSubsystem } = require('../../services/process/nodeSubsystem');

function register(app, db) {
  const { wrap } = require('../_helpers')(db);

  app.post('/api/equipment_instances/:id/process_tree/generate', (req, res) => generateProcessTree(req, res, db));
  app.get('/api/equipment_instances/:id/critical_path', (req, res) => getCriticalPath(req, res, db));
  app.get('/api/equipment_instances/:id/subsystems', (req, res) => getSubsystems(req, res, db));

  app.get('/api/equipment_instances/:id/cross_subsystem_deps', wrap((req, res) => {
    res.json(getCrossSubsystemMatrix(db, parseInt(req.params.id, 10)));
  }));

  app.get('/api/equipment_instances/:id/parts_tree', wrap((req, res) => {
    res.json(getMindmap(db, parseInt(req.params.id, 10), req.query.part_id || 'root'));
  }));

  app.get('/api/equipment_instances/:id/parts_tree/path', wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    const partId = req.query.part_id || 'root';
    res.json({ part_id: partId, breadcrumb: getBreadcrumb(db, id, partId) });
  }));

  app.patch('/api/process_nodes/:id/subsystem', (req, res) => patchNodeSubsystem(req, res, db));
}

module.exports = { register };
