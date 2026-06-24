// utils/partNo.js - 零件编号生成器
const db = require('../db');

/**
 * 生成零件编号
 * 规则：
 *   自制/焊接/加工件: <项目号>-<主结构号>-<图号>-<流水>
 *     例: TBM-2026-001-MS001-P001-01
 *   标准件: <项目号>-STD-<规格>-<流水>
 *     例: TBM-2026-001-STD-M16-001
 *   外购件: <项目号>-OUT-<供应商代码>-<流水>
 *     例: TBM-2026-001-OUT-SKF-001
 *   外协件: <项目号>-SUB-<供应商代码>-<流水>
 *   进口件: <项目号>-IMP-<供应商代码>-<流水>
 */

function nextSequence(projectId, prefix) {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM parts
    WHERE project_id = ? AND part_no LIKE ?
  `).get(projectId, `${prefix}%`);
  return String(row.cnt + 1).padStart(2, '0');
}

function generate(projectId, projectCode, mainStructureCode, drawingNo, partType = 'fabricated') {
  const seq = nextSequence(projectId, `${projectCode}-`);
  const partTypeClean = (partType || '').toLowerCase();

  if (['purchased', 'imported', 'outsourced'].includes(partTypeClean)) {
    const supplierCode = drawingNo || 'X';  // 用图号字段存供应商代码
    return `${projectCode}-${partTypeClean === 'purchased' ? 'OUT' : partTypeClean === 'imported' ? 'IMP' : 'SUB'}-${supplierCode}-${String(seq).padStart(3, '0')}`;
  }
  if (partTypeClean === 'standard') {
    return `${projectCode}-STD-${drawingNo}-${String(seq).padStart(3, '0')}`;
  }
  // 默认自制件
  const msCode = mainStructureCode || 'ROOT';
  return `${projectCode}-${msCode}-${drawingNo}-${String(seq).padStart(2, '0')}`;
}

module.exports = { generate };