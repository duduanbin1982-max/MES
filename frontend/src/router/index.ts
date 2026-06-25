import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

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
      { path: '', name: 'home', component: () => import('../views/Home.vue'), meta: { title: '首页' } },
      { path: '/dashboard', name: 'dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '仪表盘', icon: 'DataBoard' } },
      { path: '/instances', name: 'instances', component: () => import('../views/EquipmentInstances.vue'), meta: { title: '装备实例', icon: 'Box' } },
      { path: '/instances/:id', name: 'instance-detail', component: () => import('../views/EquipmentInstanceDetail.vue'), meta: { title: '实例详情', hidden: true } },
      { path: '/materials', name: 'materials', component: () => import('../views/MaterialCenter.vue'), meta: { title: '物料中心', icon: 'Goods' } },
      { path: '/inventory', redirect: '/materials?tab=inv' },
      { path: '/reports', name: 'reports', component: () => import('../views/Reports.vue'), meta: { title: '报表中心', icon: 'DataLine' } },
      { path: '/eco', name: 'eco', component: () => import('../views/Eco.vue'), meta: { title: '设计变更', icon: 'Refresh' } },
      { path: '/gantt', name: 'gantt', component: () => import('../views/Gantt.vue'), meta: { title: 'gantt', icon: 'Calendar' } },
      { path: '/multi-schedule', name: 'multi-schedule', component: () => import('../views/MultiSchedule.vue'), meta: { title: '多项目排程', icon: 'Connection' } },
      { path: '/oee', name: 'oee', component: () => import('../views/OEE.vue'), meta: { title: 'OEE', icon: 'Cpu' } },
      { path: '/settings', name: 'settings', component: () => import('../views/Settings.vue'), meta: { title: '系统设置', icon: 'Setting' } },
      { path: '/quality', name: 'quality', component: () => import('../views/Quality.vue'), meta: { title: '质检管理', icon: 'CircleCheck' } },
      { path: '/schedule', name: 'schedule', component: () => import('../views/Schedule.vue'), meta: { title: '项目排程', icon: 'Calendar' } },
      { path: '/process-tree', name: 'process-tree', component: () => import('../views/ProcessTree.vue'), meta: { title: '工艺树', icon: 'Share' } },
      { path: '/work-orders', name: 'work-orders', component: () => import('../views/WorkOrders.vue'), meta: { title: '工单管理', icon: 'Document' } },
      { path: '/field-service', name: 'field-service', component: () => import('../views/FieldService.vue'), meta: { title: '现场服务', icon: 'Tools' } },
      { path: '/audit', name: 'audit', component: () => import('../views/AuditLogs.vue'), meta: { title: '审计日志', icon: 'DocumentChecked' } },
      { path: '/documents', name: 'documents', component: () => import('../views/DocumentManagement.vue'), meta: { title: '文档/图纸', icon: 'FolderOpened', requires: 'equipment:read' } },
            { path: '/bom', name: 'bom', component: () => import('../views/BomManagement.vue'), meta: { title: 'BOM 管理', icon: 'SetUp', requires: 'equipment:read' } }
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

router.beforeEach((to, from, next) => {
  // P0-2: 用 access_token key (兼容旧 tbm_token)
  const token = localStorage.getItem('tbm_access_token') || localStorage.getItem('tbm_token')
  if (to.path === '/login') return next()
  if (!token && to.meta?.requiresAuth !== false) {
    return next('/login')
  }
  // P0-1: permission 守卫 (meta.requires 任一满足)
  if (to.meta?.requires) {
    const auth = useAuthStore()
    const needs = Array.isArray(to.meta.requires) ? to.meta.requires : [to.meta.requires]
    if (!auth.hasAnyPerm(...needs)) {
      return next('/')  // 无权访问 → 回首页
    }
  }
  next()
})

export default router
