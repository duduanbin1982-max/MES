export type ActionButtonType = 'default' | 'primary' | 'success' | 'warning' | 'info' | 'danger' | 'text'

export interface FlowAction {
  label: string
  type?: ActionButtonType
  needInstance?: boolean
  route?: string
  loadingKey?: string
  handler?: () => void | Promise<void>
}

export interface FlowStep {
  key: string
  title: string
  module: string
  purpose: string
  evidence: string
  status: string
  actions: FlowAction[]
}

interface FlowStepInput {
  selectedInstance: any
  selectedInstanceId: number | null
  bomCount: number
  bomScore: number
  docsCount: number
  processTotal: number
  kitTotal: number
  kitBlocked: number
  kitPartial: number
  workOrderTotal: number
  dispatchedTotal: number
  completedWorkOrders: number
  inspectionCount: number
  ncrCount: number
  openNcrCount: number
  actualCost: number
  estimatedCost: number
  pendingKeyComponents: number
  acceptanceTotal: number
  acceptanceDone: number
  statusOf: (done: boolean, partial?: boolean) => string
  routeFor: (path: string) => string
  onCreate: () => void
  initMinimumBom: () => Promise<void>
  generateProcessRoutes: () => Promise<void>
}

export function buildProjectFlowSteps(input: FlowStepInput): FlowStep[] {
  const {
    selectedInstance, selectedInstanceId, bomCount, bomScore, docsCount, processTotal,
    kitTotal, kitBlocked, kitPartial, workOrderTotal, dispatchedTotal, completedWorkOrders,
    inspectionCount, ncrCount, openNcrCount, actualCost, estimatedCost, pendingKeyComponents,
    acceptanceTotal, acceptanceDone, statusOf, routeFor, onCreate, initMinimumBom, generateProcessRoutes,
  } = input

  return [
    {
      key: 'project',
      title: '建立项目装备',
      module: '项目与装备 → 项目装备',
      purpose: '建立这台 TBM 的唯一业务主对象，后续所有数据都挂在它下面。',
      evidence: selectedInstance ? `已选择 ${selectedInstance.instance_code}` : '尚未选择项目装备',
      status: statusOf(Boolean(selectedInstance)),
      actions: [
        { label: '新建项目装备', type: 'primary', needInstance: false, handler: onCreate },
        { label: '查看项目详情', route: selectedInstanceId ? `/instances/${selectedInstanceId}` : '/instances' },
      ],
    },
    {
      key: 'bom',
      title: '建立树状 BOM',
      module: '设计与BOM → BOM 管理',
      purpose: '按 0级整机、1级主要部件、2级子部件/零件建立可展开的产品结构树。',
      evidence: `当前 BOM 节点 ${bomCount} 个，健康度 ${bomScore || 0} 分`,
      status: statusOf(bomCount >= 3, bomCount > 0),
      actions: [
        { label: '打开 BOM 树', type: 'primary', route: routeFor('/bom') },
        { label: '生成最低三级骨架', loadingKey: 'bom', handler: initMinimumBom },
      ],
    },
    {
      key: 'docs',
      title: '绑定图纸/SOP',
      module: '设计与BOM → 文档/图纸',
      purpose: '把图纸、SOP、检验标准绑定到项目装备或 BOM 节点，保证现场看到最新版。',
      evidence: `当前已关联文档 ${docsCount} 份`,
      status: statusOf(docsCount > 0),
      actions: [{ label: '上传图纸/SOP', type: 'primary', route: routeFor('/documents') }],
    },
    {
      key: 'process',
      title: '建立工艺路线',
      module: '设计与BOM → 工艺树',
      purpose: '为每个主要部件定义工序、标准工时、工位、质检要求和前后置关系。',
      evidence: `当前工艺节点 ${processTotal} 个`,
      status: statusOf(processTotal > 0),
      actions: [
        { label: '打开工艺树', type: 'primary', route: routeFor('/process-tree') },
        { label: '按 BOM 生成缺失工艺', loadingKey: 'process', handler: generateProcessRoutes },
      ],
    },
    {
      key: 'kit',
      title: '齐套/缺料检查',
      module: '采购与库存 → 齐套/缺料闭环',
      purpose: '生产前检查 BOM 需求与库存/采购到货，发现缺料并分派责任人。',
      evidence: kitTotal ? `齐套工单 ${kitTotal} 个，阻塞 ${kitBlocked} 个，部分齐套 ${kitPartial} 个` : '进入齐套页面查看缺料、责任人、预计到货和采购跟催状态',
      status: statusOf(kitTotal > 0 && kitBlocked === 0 && kitPartial === 0, bomCount > 0 || kitTotal > 0),
      actions: [
        { label: '打开齐套闭环', type: 'primary', route: routeFor('/kit-closure') },
        { label: '采购跟催', route: routeFor('/purchase?tab=followup') },
      ],
    },
    {
      key: 'workorder',
      title: '生成工单',
      module: '生产执行 → 工单管理',
      purpose: '把项目装备、BOM 部件和工艺路线转成可执行的生产任务。',
      evidence: `当前工单 ${workOrderTotal} 张`,
      status: statusOf(workOrderTotal > 0),
      actions: [{ label: '打开工单管理', type: 'primary', route: routeFor('/work-orders?tab=list') }],
    },
    {
      key: 'dispatch',
      title: '派工到人/工位',
      module: '生产执行 → 生产单元派工',
      purpose: '把工单下发给班组、人员和工位，形成现场可执行任务。',
      evidence: `已派工/执行/完成 ${dispatchedTotal} 张`,
      status: statusOf(dispatchedTotal > 0, workOrderTotal > 0),
      actions: [{ label: '进入待派工', type: 'primary', route: routeFor('/work-orders?tab=dispatch') }],
    },
    {
      key: 'shopfloor',
      title: '领料与报工',
      module: '生产执行 → 车间工作台',
      purpose: '现场扫码领料、查看图纸、报工、质检录入、异常上报。',
      evidence: `已完工 ${completedWorkOrders} 张；未完工 ${Math.max(workOrderTotal - completedWorkOrders, 0)} 张`,
      status: statusOf(completedWorkOrders > 0, dispatchedTotal > 0),
      actions: [
        { label: '扫码报工', type: 'primary', route: routeFor('/shopfloor?tab=scan') },
        { label: '领料', route: routeFor('/shopfloor?tab=pick') },
      ],
    },
    {
      key: 'quality',
      title: '质检闭环',
      module: '质量与追溯 → 过程/出厂检验',
      purpose: '记录来料、过程、出厂检验；不合格进入 NCR/CAPA 闭环。',
      evidence: `质检记录 ${inspectionCount} 条，NCR ${ncrCount} 个，未闭环 ${openNcrCount} 个`,
      status: statusOf(inspectionCount > 0 && openNcrCount === 0, completedWorkOrders > 0 || inspectionCount > 0 || ncrCount > 0),
      actions: [
        { label: '过程检验', type: 'primary', route: routeFor('/quality?tab=inspections&type=in_process') },
        { label: 'NCR/CAPA', route: routeFor('/quality?tab=ncr') },
      ],
    },
    {
      key: 'cost',
      title: '成本归集',
      module: '成本与经营 → 成本归集',
      purpose: '把材料、人工、外协、折旧、返工、质量损失归集到项目装备。',
      evidence: actualCost ? `已归集 ${actualCost.toLocaleString('zh-CN')} 元，待签关键件 ${pendingKeyComponents} 项` : '进入成本归集查看项目成本偏差与明细科目',
      status: statusOf(actualCost > 0 && pendingKeyComponents === 0, estimatedCost > 0 || actualCost > 0 || workOrderTotal > 0),
      actions: [{ label: '查看成本归集', type: 'primary', route: routeFor('/cost') }],
    },
    {
      key: 'accept',
      title: '客户验收交付',
      module: '项目与装备 → 客户验收',
      purpose: '完成整机调试、出厂验收、签收和交付归档。',
      evidence: acceptanceTotal ? `验收单 ${acceptanceTotal} 张，已完成 ${acceptanceDone} 张` : '交付后建议冻结 BOM、图纸、工艺和成本基线',
      status: statusOf(acceptanceTotal > 0 && acceptanceDone >= acceptanceTotal, completedWorkOrders > 0 || acceptanceTotal > 0),
      actions: [{ label: '客户验收', type: 'primary', route: routeFor('/tbm-advanced?tab=accept') }],
    },
  ]
}
