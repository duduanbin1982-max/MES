"use strict";
// app/permissions.js
// P0-1 RBAC permission 代码体系
//   命名: <resource>:<action>
//   特殊: '*' 表示 super admin 所有权限
// Author: 三狗子 | Date: 2026-06-25

const PERMISSIONS = {
  // 现场/仓库
  'shopfloor:read': '查看车间工作台',
  'inventory:read': '查看库存与库存流水',
  'inventory:write': '库存收发料/调拨/领退料',
  'pick:read': '查看齐套/领退料清单',
  'pick:write': '执行领料/退料/缺料闭环',
  'document:read': '查看文档/图纸并签收',
  'document:write': '上传/签发/收回文档图纸',
  // 物料
  'material:read': '查看物料/库存/批次',
  'material:write': '创建/更新物料/批次/库存移动',
  'material:admin': '删批/合批/调价 (高危)',
  // 采购
  'purchase:read': '查看供应商/采购单',
  'purchase:write': '创建/更新采购单/收货',
  'purchase:admin': '关闭/作废采购单 (高危)',
  // 装备实例
  'equipment:read': '查看装备/排程/OEE',
  'equipment:write': '创建/更新装备/排程',
  'equipment:admin': '删除装备/解锁节点',
  // 工单
  'work_order:read': '查看工单/工序',
  'work_order:write': '创建/更新工单/工序/报工',
  'work_order:admin': '关闭/作废工单',
  // 工艺
  'process:read': '查看工艺树/节点/参数',
  'process:write': '创建/更新工艺节点/依赖',
  'process:admin': '执行工艺节点/自动解锁',
  // 质量
  'quality:read': '查看检验记录',
  'delivery:read': '查看交付/验收/回款',
  'delivery:write': '维护交付/验收/回款',
  'quality:write': '创建/更新检验',
  // 报表
  'report:read': '查看所有报表/仪表盘',
  // 平台管理
  'user:read': '查看用户/角色',
  'user:admin': '创建/更新/删除用户',
  'settings:read': '查看系统设置',
  'settings:write': '修改系统设置/集成',
  'audit:read': '查看审计日志',
};

// 默认角色权限映射 (兼容旧 role 字符串)
//   旧 role 还在, 但业务层逐步从 requireRole 转 requirePermission
//   没传 permissions 的旧用户 (迁移兜底) 用这张表
const DEFAULT_ROLE_PERMISSIONS = {
  admin: ['*'],
  warehouse: [
    'shopfloor:read', 'material:read', 'material:write',
    'inventory:read', 'inventory:write', 'pick:read',
    'pick:write', 'document:read', 'work_order:read',
    'equipment:read', 'delivery:read',
  ],
  planner: [
    'equipment:read', 'equipment:write', 'work_order:read',
    'work_order:write', 'process:read', 'material:read',
    'material:write', 'purchase:read', 'purchase:write',
    'report:read', 'delivery:read', 'delivery:write',
  ],
  foreman: [
    'work_order:read', 'work_order:write', 'shopfloor:read',
    'equipment:read', 'equipment:write', 'process:read',
    'process:write', 'quality:read', 'quality:write',
    'material:read', 'report:read', 'delivery:read', 'delivery:write',
  ],
  production_supervisor: [
    'work_order:read', 'work_order:write', 'work_order:admin',
    'equipment:read', 'equipment:write', 'process:read',
    'material:read', 'quality:read', 'report:read',
    'shopfloor:read', 'delivery:read', 'delivery:write',
  ],
  engineer: [
    'equipment:read', 'process:read', 'process:write',
    'material:read', 'document:read', 'document:write',
    'settings:read', 'report:read', 'delivery:read',
  ],
  qc: [
    'quality:read', 'quality:write', 'work_order:read',
    'material:read', 'document:read', 'report:read',
    'delivery:read',
  ],
  worker: [
    'shopfloor:read', 'work_order:read', 'quality:read',
    'document:read', 'pick:read', 'delivery:read',
  ],
  welder: [
    'work_order:read', 'quality:read', 'quality:write',
    'shopfloor:read', 'delivery:read',
  ],
  sales: [
    'equipment:read', 'document:read', 'report:read',
    'delivery:read',
  ],
  purchaser: [
    'purchase:read', 'purchase:write', 'material:read',
    'report:read', 'delivery:read',
  ],
};

// 检查 permission 是否被授予
//   perms: ['material:read', ...] 或 ['*']
//   required: 'material:write'
function hasPermission(perms, required) {
  if (!Array.isArray(perms)) return false;
  if (perms.includes('*')) return true;                       // super admin
  if (perms.includes(required)) return true;                  // 精确匹配
  // 资源级通配: 'material:*' 匹配 'material:write/read/admin'
  return perms.some(p => typeof p === 'string' && p.endsWith(':*') && required.startsWith(p.slice(0, -1)));
}

module.exports = { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, hasPermission };
