import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { buildPageTitle } from '../domain/ux'
import { startRouteProgress, finishRouteProgress } from '../composables/useRouteProgress'

const routes = [
  {
    path: '/login',
    component: () => import('../views/Login.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/',
    component: () => import('../views/Layout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '/shopfloor', name: 'shopfloor', component: () => import('../views/ShopfloorWorkspace.vue'), meta: { title: '车间工作台', icon: 'Cellphone' } },
      { path: '', name: 'home', component: () => import('../views/Home.vue'), meta: { title: '首页' } },
      { path: '/help/manual', name: 'operation-manual', component: () => import('../views/OperationManual.vue'), meta: { title: '操作手册' } },
      { path: '/delivery', name: 'delivery', component: () => import('../views/DeliveryDashboard.vue'), meta: { title: '项目交付看板', icon: 'Finished' } },
      { path: '/setup', name: 'setup', component: () => import('../views/SetupWizard.vue'), meta: { title: '初始化向导', icon: 'Guide' } },
      { path: '/project-wizard', name: 'project-wizard', component: () => import('../views/ProjectLaunchWizard.vue'), meta: { title: '项目启动向导', icon: 'Guide' } },
      { path: '/mdm', name: 'mdm', component: () => import('../views/MasterDataGovernance.vue'), meta: { title: '主数据治理', icon: 'DataAnalysis' } },
      { path: '/coding-rules', name: 'coding-rules', component: () => import('../views/CodingRules.vue'), meta: { title: '编码规则', icon: 'DataAnalysis', requires: 'settings:read' } },
      { path: '/exceptions', name: 'exceptions', component: () => import('../views/ExceptionCenter.vue'), meta: { title: '异常中心', icon: 'WarningFilled' } },
      { path: '/dashboard', name: 'dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '仪表盘', icon: 'DataBoard' } },
      { path: '/instances', name: 'instances', component: () => import('../views/EquipmentInstances.vue'), meta: { title: '项目装备', icon: 'Box' } },
      { path: '/instances/:id', name: 'instance-detail', component: () => import('../views/EquipmentInstanceDetail.vue'), meta: { title: '项目装备详情', hidden: true } },
      { path: '/kit-closure', name: 'kit-closure', component: () => import('../views/KitClosure.vue'), meta: { title: '齐套缺料', icon: 'Box' } },
      { path: '/materials', name: 'materials', component: () => import('../views/MaterialCenter.vue'), meta: { title: '物料中心', icon: 'Goods' } },
      { path: '/inventory', redirect: '/materials?tab=inv', meta: { hidden: true } },
      { path: '/material-alerts', name: 'material-alerts', component: () => import('../views/MaterialAlerts.vue'), meta: { title: '物料预警', icon: 'Warning' } },
      { path: '/purchase', name: 'purchase', component: () => import('../views/PurchaseManagement.vue'), meta: { title: '采购管理', icon: 'ShoppingCart' } },
      { path: '/reports', name: 'reports', component: () => import('../views/Reports.vue'), meta: { title: '报表中心', icon: 'DataLine' } },
      { path: '/business-reports', name: 'business-reports', component: () => import('../views/BusinessReports.vue'), meta: { title: '经营分析报表', icon: 'DataLine' } },
      { path: '/eco', name: 'eco', component: () => import('../views/Eco.vue'), meta: { title: '设计变更', icon: 'Refresh' } },
      { path: '/gantt', name: 'gantt', component: () => import('../views/Gantt.vue'), meta: { title: '单项目甘特', icon: 'Calendar' } },
      { path: '/multi-schedule', name: 'multi-schedule', component: () => import('../views/MultiSchedule.vue'), meta: { title: '多项目资源平衡', icon: 'Connection' } },
      { path: '/oee', name: 'oee', component: () => import('../views/OEE.vue'), meta: { title: 'OEE', icon: 'Cpu', requires: 'equipment:read' } },
      { path: '/settings', name: 'settings', component: () => import('../views/Settings.vue'), meta: { title: '系统设置', icon: 'Setting' } },
      { path: '/quality', name: 'quality', component: () => import('../views/Quality.vue'), meta: { title: '质检管理', icon: 'CircleCheck', requires: 'quality:read' } },
      { path: '/schedule', name: 'schedule', component: () => import('../views/Schedule.vue'), meta: { title: '项目排程', icon: 'Calendar' } },
      { path: '/process-tree', name: 'process-tree', component: () => import('../views/ProcessTree.vue'), meta: { title: '工艺树', icon: 'Share' } },
      { path: '/process-master', name: 'process-master', component: () => import('../views/ProcessMaster.vue'), meta: { title: '工序/岗位配置', icon: 'Operation', requires: 'process:read' } },
      { path: '/process-hours', name: 'process-hours', component: () => import('../views/ProcessHours.vue'), meta: { title: '工时与报工', icon: 'Clock' } },
      { path: '/process-params', name: 'process-params', component: () => import('../views/ProcessParams.vue'), meta: { title: '工艺参数', icon: 'SetUp' } },
      { path: '/work-orders', name: 'work-orders', component: () => import('../views/WorkOrders.vue'), meta: { title: '工单管理', icon: 'Document' } },
      { path: '/trace', name: 'trace', component: () => import('../views/Trace.vue'), meta: { title: '端到端追溯', icon: 'Search' } },
      { path: '/tbm-advanced', name: 'tbm-advanced', component: () => import('../views/TbmAdvanced.vue'), meta: { title: 'TBM 专项', icon: 'SetUp' } },
      { path: '/spc', name: 'spc', component: () => import('../views/Spc.vue'), meta: { title: 'SPC 控制图', icon: 'TrendCharts' } },
      { path: '/andon', name: 'andon', component: () => import('../views/Andon.vue'), meta: { title: 'ANDON 安灯', icon: 'Bell' } },
      
      { path: '/project-equipment-maintenance', name: 'project-equipment-maintenance', component: () => import('../views/MaintenanceDashboard.vue'), meta: { title: '项目装备维护', icon: 'Tools', requires: 'equipment:read' } },
      { path: '/maintenance', redirect: '/project-equipment-maintenance' },
      { path: '/field-service', name: 'field-service', component: () => import('../views/FieldService.vue'), meta: { title: '设备维保', icon: 'Tools' } },
      { path: '/audit', name: 'audit', component: () => import('../views/AuditLogs.vue'), meta: { title: '审计日志', icon: 'DocumentChecked' } },
      { path: '/labor', name: 'labor', component: () => import('../views/LaborDashboard.vue'), meta: { title: '劳动力管理', icon: 'UserFilled', requires: 'user:read' } },
      { path: '/documents', name: 'documents', component: () => import('../views/DocumentManagement.vue'), meta: { title: '文档/图纸', icon: 'FolderOpened', requires: 'document:read' } },
      { path: '/bom', name: 'bom', component: () => import('../views/BomManagement.vue'), meta: { title: 'BOM 管理', icon: 'SetUp', requires: 'equipment:read' } },
      { path: '/users', name: 'users', component: () => import('../views/UserManagement.vue'), meta: { title: '用户管理', icon: 'User' } },
      
      { path: '/critical-parts', name: 'critical-parts', component: () => import('../views/CriticalParts.vue'), meta: { title: '关键件管理', icon: 'Key' } },
      { path: '/cost', name: 'cost', component: () => import('../views/CostAllocation.vue'), meta: { title: '成本归集', icon: 'Money' } },
      { path: '/price-variance', name: 'price-variance', component: () => import('../views/PriceVariance.vue'), meta: { title: '采购估价 vs 实际合同价', icon: 'DataLine' } },
      { path: '/cost-variance', name: 'cost-variance', component: () => import('../views/CostAllocation.vue'), meta: { title: '项目成本偏差', icon: 'DataAnalysis' } },
      { path: '/outsourcing-depreciation-cost', name: 'outsourcing-depreciation-cost', component: () => import('../views/OutsourcingDepreciationCost.vue'), meta: { title: '外协/折旧成本', icon: 'Money' } },
      { path: '/workflow', name: 'workflow', component: () => import('../views/WorkflowEngine.vue'), meta: { title: '工作流引擎', icon: 'Guide' } },
      { path: '/iot', name: 'iot', component: () => import('../views/IoTMonitor.vue'), meta: { title: 'IoT 监控', icon: 'Connection' } },
      { path: '/plm', name: 'plm', component: () => import('../views/PlmDrawings.vue'), meta: { title: 'PLM 图纸', icon: 'EditPen' } },
      { path: '/ai', name: 'ai', component: () => import('../views/AiPrediction.vue'), meta: { title: 'AI 预测', icon: 'MagicStick' } },
      { path: '/erp', name: 'erp', component: () => import('../views/ErpLedger.vue'), meta: { title: 'ERP 台账', icon: 'Money' } },
      
      { path: '/suppliers', name: 'suppliers', component: () => import('../views/SupplierDashboard.vue'), meta: { title: '供应商协同', icon: 'Connection' } },
      { path: '/project-equipment-ledger', name: 'project-equipment-ledger', component: () => import('../views/ProjectEquipmentLedger.vue'), meta: { title: '项目装备台账', icon: 'Box' } },
      { path: '/equipment-ledger', name: 'equipment-ledger', component: () => import('../views/EquipmentLedger.vue'), meta: { title: '设备台账', icon: 'Monitor' } },
      { path: '/workstation-resources', name: 'workstation-resources', component: () => import('../views/WorkstationResources.vue'), meta: { title: '工位/资源配置', icon: 'OfficeBuilding' } },
      { path: '/resources', name: 'resources', component: () => import('../views/ResourceDashboard.vue'), meta: { title: '资源分配与状态', icon: 'Monitor' } },
      { path: '/digital-twin', name: 'digital-twin', component: () => import('../views/DigitalTwin.vue'), meta: { title: '数字孪生', icon: 'Monitor' } },
      { path: '/mobile-center', name: 'mobile-center', component: () => import('../views/MobileCenter.vue'), meta: { title: '移动端设置', icon: 'Cellphone' } },
      { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFound.vue'), meta: { title: '页面不存在', hidden: true } },
    ]
  },
  {
    path: '/scan',
    component: () => import('../views/Scan.vue'),
    meta: { title: '扫码报工' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

const WAREHOUSE_ALLOWED_PATHS = new Set([
  '/',
  '/shopfloor',
  '/kit-closure',
  '/materials',
  '/inventory',
  '/material-alerts',
  '/work-orders',
  '/documents',
  '/scan',
])

const WAREHOUSE_DEFAULT_PATH = '/shopfloor?tab=pick'

router.beforeEach((to, from, next) => {
  startRouteProgress()
  const token = localStorage.getItem('tbm_access_token') || localStorage.getItem('tbm_token')
  if (to.path === '/login') return next()
  if (!token && to.meta?.requiresAuth !== false) {
    return next('/login')
  }
  const auth = useAuthStore()
  if (auth.user?.role === 'warehouse' && !WAREHOUSE_ALLOWED_PATHS.has(to.path)) {
    return next(WAREHOUSE_DEFAULT_PATH)
  }
  if (to.meta?.requires) {
    const needs = Array.isArray(to.meta.requires) ? to.meta.requires : [to.meta.requires]
    if (!auth.hasAnyPerm(...needs)) {
      return next('/')
    }
  }
  next()
})

router.afterEach((to) => {
  finishRouteProgress()
  document.title = buildPageTitle(to.meta?.title as string | undefined)
})

router.onError(() => {
  finishRouteProgress()
})

export default router
