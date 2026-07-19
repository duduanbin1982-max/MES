// frontend/src/config/menuCatalog.ts

export type MenuItem = {
  key: string
  title: string
  to: string
  icon: string
  permission?: string | string[]
  roles?: string[]
}

export type MenuSection = {
  key: string
  title: string
  icon: string
  items: MenuItem[]
}

export const MENU_SECTIONS: MenuSection[] = [
  {
    key: 'cockpit',
    title: '首页驾驶舱',
    icon: 'DataBoard',
    items: [
      { key: 'dashboard', title: '仪表盘', to: '/dashboard', icon: 'DataBoard', permission: 'report:read' },
      { key: 'delivery', title: '项目交付看板', to: '/delivery', icon: 'Finished', permission: 'report:read' },
      { key: 'reports', title: '报表中心', to: '/reports?tab=instant', icon: 'DataLine', permission: 'report:read' },
      { key: 'oee', title: 'OEE 深度分析', to: '/oee', icon: 'Cpu', permission: 'equipment:read' },
    ],
  },
  {
    key: 'project',
    title: '项目与装备',
    icon: 'Finished',
    items: [
      { key: 'project-wizard', title: '项目启动向导', to: '/project-wizard', icon: 'Guide', permission: 'equipment:read' },
      { key: 'instances', title: '项目装备', to: '/instances', icon: 'Box', permission: 'equipment:read' },
      { key: 'schedule', title: '项目排程', to: '/schedule', icon: 'Calendar', permission: 'work_order:read' },
      { key: 'gantt', title: '单项目甘特', to: '/gantt', icon: 'Calendar', permission: 'equipment:read' },
      { key: 'tbm-advanced', title: 'TBM 增强', to: '/tbm-advanced?tab=project', icon: 'SetUp', permission: 'equipment:read' },
      { key: 'acceptance', title: '客户验收', to: '/tbm-advanced?tab=accept', icon: 'CircleCheck', permission: 'equipment:read' },
    ],
  },
  {
    key: 'design',
    title: '设计与BOM',
    icon: 'Box',
    items: [
      { key: 'bom', title: 'BOM 管理', to: '/bom', icon: 'SetUp', permission: 'equipment:read' },
      { key: 'documents', title: '文档/图纸', to: '/documents', icon: 'FolderOpened', permission: 'document:read' },
      { key: 'eco', title: '设计变更(ECO)', to: '/eco', icon: 'Refresh', permission: 'settings:read' },
      { key: 'process-tree', title: '工艺树', to: '/process-tree', icon: 'Share', permission: 'process:read' },
      { key: 'process-master', title: '工序/岗位配置', to: '/process-master', icon: 'Operation', permission: 'process:read' },
      { key: 'process-params', title: '工艺参数', to: '/process-params', icon: 'SetUp', permission: 'process:read' },
      { key: 'spc-design', title: 'SPC 控制图', to: '/spc', icon: 'TrendCharts', permission: 'quality:read' },
    ],
  },
  {
    key: 'execution',
    title: '生产执行',
    icon: 'Calendar',
    items: [
      { key: 'work-orders', title: '工单管理', to: '/work-orders?tab=list', icon: 'Document', permission: 'work_order:read' },
      { key: 'process-hours', title: '工时与报工', to: '/process-hours', icon: 'Clock', permission: 'work_order:read' },
      { key: 'shopfloor', title: '车间工作台', to: '/shopfloor', icon: 'Cellphone', permission: 'shopfloor:read' },
      { key: 'dispatch', title: '生产单元派工', to: '/work-orders?tab=dispatch', icon: 'Guide', permission: 'work_order:read' },
      { key: 'scan', title: '扫码报工', to: '/scan', icon: 'Cellphone', permission: 'shopfloor:read' },
    ],
  },
  {
    key: 'supply',
    title: '采购与库存',
    icon: 'Goods',
    items: [
      { key: 'materials', title: '物料中心', to: '/materials?tab=materials', icon: 'Goods', permission: 'material:read' },
      { key: 'material-units', title: '单位换算', to: '/materials?tab=units', icon: 'SetUp', permission: 'material:read' },
      { key: 'inventory', title: '库存清单', to: '/materials?tab=inv', icon: 'Box', permission: 'material:read' },
      { key: 'material-alerts', title: '库存预警', to: '/material-alerts', icon: 'Warning', permission: 'material:read' },
      { key: 'purchase-orders', title: '采购管理', to: '/purchase?tab=orders', icon: 'ShoppingCart', permission: 'purchase:read' },
      { key: 'suppliers', title: '供应商管理', to: '/purchase?tab=suppliers', icon: 'User', permission: 'purchase:read' },
      { key: 'kit-closure', title: '齐套/缺料闭环', to: '/kit-closure', icon: 'Box', permission: 'pick:read' },
      { key: 'purchase-followup', title: '采购跟催', to: '/purchase?tab=followup', icon: 'Connection', permission: 'purchase:read' },
    ],
  },
  {
    key: 'quality',
    title: '质量与追溯',
    icon: 'CircleCheck',
    items: [
      { key: 'quality', title: '质检管理', to: '/quality?tab=inspections', icon: 'CircleCheck', permission: 'quality:read' },
      { key: 'ncr', title: 'NCR / CAPA', to: '/quality?tab=ncr', icon: 'WarningFilled', permission: 'quality:read' },
      { key: 'incoming-qc', title: '来料检验', to: '/quality?tab=inspections&type=incoming', icon: 'CircleCheck', permission: 'quality:read' },
      { key: 'process-qc', title: '过程检验', to: '/quality?tab=inspections&type=in_process', icon: 'CircleCheck', permission: 'quality:read' },
      { key: 'final-qc', title: '出厂检验', to: '/quality?tab=inspections&type=final', icon: 'CircleCheck', permission: 'quality:read' },
      { key: 'trace', title: '端到端追溯', to: '/trace', icon: 'Search', permission: ['material:read', 'work_order:read'] },
      { key: 'critical-parts', title: '关键件管理', to: '/tbm-advanced?tab=critical', icon: 'SetUp', permission: 'equipment:read' },
    ],
  },
  {
    key: 'service',
    title: '设备与维护',
    icon: 'Tools',
    items: [
      { key: 'equipment-ledger', title: '设备台账', to: '/equipment-ledger', icon: 'Monitor', permission: 'equipment:read' },
      { key: 'tpm', title: '点检 / TPM', to: '/field-service?tab=logs', icon: 'Tools', permission: 'equipment:read' },
      { key: 'maintenance-plans', title: '维保计划', to: '/field-service?tab=plans', icon: 'Calendar', permission: 'equipment:read' },
      { key: 'field-service', title: '现场服务', to: '/field-service', icon: 'Tools', permission: 'equipment:read' },
      { key: 'spares', title: '备件库', to: '/field-service?tab=spares', icon: 'Box', permission: 'equipment:read' },
      { key: 'iot', title: 'IoT 设备监控大屏', to: '/iot', icon: 'Connection', permission: 'equipment:read' },
      { key: 'digital-twin', title: '数字孪生', to: '/digital-twin', icon: 'Monitor', permission: 'equipment:read' },
    ],
  },
  {
    key: 'cost',
    title: '成本与经营',
    icon: 'Money',
    items: [
      { key: 'cost', title: '成本归集', to: '/cost', icon: 'Money', permission: 'report:read' },
      { key: 'price-variance', title: '采购估价 vs 实际合同价', to: '/price-variance', icon: 'DataLine', permission: 'report:read' },
      { key: 'cost-variance', title: '项目成本偏差', to: '/cost-variance', icon: 'DataAnalysis', permission: 'report:read' },
      { key: 'outsource-depreciation', title: '外协/折旧成本', to: '/outsourcing-depreciation-cost', icon: 'Money', permission: 'report:read' },
      { key: 'business-reports', title: '经营分析报表', to: '/business-reports', icon: 'DataLine', permission: 'report:read' },
    ],
  },
  {
    key: 'exception',
    title: '异常与协同',
    icon: 'WarningFilled',
    items: [
      { key: 'exceptions', title: '异常中心', to: '/exceptions', icon: 'WarningFilled', permission: 'work_order:read' },
      { key: 'andon', title: 'ANDON 安灯', to: '/andon', icon: 'Bell', permission: 'work_order:read' },
      { key: 'risk-todo', title: '风险待办池', to: '/exceptions?status=open', icon: 'Warning', permission: 'work_order:read' },
      { key: 'purchase-exceptions', title: '采购异常', to: '/exceptions?type=purchase_delay', icon: 'ShoppingCart', permission: 'purchase:read' },
      { key: 'quality-exceptions', title: '质量异常', to: '/exceptions?type=quality_ncr', icon: 'CircleCheck', permission: 'quality:read' },
      { key: 'mdm-exceptions', title: '主数据治理异常', to: '/exceptions?type=mdm_materials', icon: 'DataAnalysis', permission: 'settings:read' },
    ],
  },
  {
    key: 'system',
    title: '系统管理',
    icon: 'Setting',
    items: [
      { key: 'users', title: '用户管理', to: '/users?tab=users', icon: 'User', permission: 'user:read' },
      { key: 'roles', title: '角色与权限', to: '/users?tab=matrix', icon: 'Lock', permission: 'user:read' },
      { key: 'role-groups', title: '角色组', to: '/users?tab=groups', icon: 'UserFilled', permission: 'user:read' },
      { key: 'workstations', title: '工位/资源配置', to: '/workstation-resources', icon: 'OfficeBuilding', permission: 'equipment:read' },
      { key: 'labor', title: '人员资质', to: '/labor', icon: 'UserFilled', permission: 'user:read' },
      { key: 'coding-rules', title: '编码规则', to: '/mdm', icon: 'DataAnalysis', permission: 'settings:read' },
      { key: 'settings', title: '参数配置', to: '/settings', icon: 'Setting', permission: 'settings:read' },
      { key: 'system-diagnostics', title: '系统诊断', to: '/settings?tab=diagnostics', icon: 'Monitor', permission: 'settings:read' },
      { key: 'audit', title: '审计日志', to: '/audit', icon: 'DocumentChecked', permission: 'audit:read' },
    ],
  },
]
