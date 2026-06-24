<template>
  <div class="page">
    <div class="page-header">
      <div>
        <el-button @click="$router.back()" size="small" style="margin-right: 12px">
          <el-icon><ArrowLeft /></el-icon>返回
        </el-button>
        <span class="page-title" v-if="inst">{{ inst.instance_code }} · {{ inst.instance_name }}</span>
      </div>
      <div v-if="inst">
        <el-tag :type="statusTagType(inst.status)" size="default">{{ statusLabel(inst.status) }}</el-tag>
        <el-tag style="margin-left: 8px" type="info">{{ inst.lifecycle_stage || '-' }}</el-tag>
      </div>
    </div>

    <div v-loading="loading">
      <el-tabs v-model="tab">
        <!-- 总览 -->
        <el-tab-pane label="总览" name="overview">
          <el-row :gutter="16">
            <el-col :span="14">
              <el-card title="基本信息">
                <el-descriptions :column="2" border>
                  <el-descriptions-item label="实例编号">{{ inst?.instance_code }}</el-descriptions-item>
                  <el-descriptions-item label="出厂序列号">{{ inst?.serial_no || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="名称">{{ inst?.instance_name }}</el-descriptions-item>
                  <el-descriptions-item label="生命周期">{{ inst?.lifecycle_stage || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="产品类别">{{ inst?.type_name || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="型号">{{ inst?.model_name }} ({{ inst?.model_code }})</el-descriptions-item>
                  <el-descriptions-item label="开挖直径">{{ inst?.diameter_mm ? inst.diameter_mm + ' mm' : '-' }}</el-descriptions-item>
                  <el-descriptions-item label="合同金额">{{ inst?.contract_amount ? inst.contract_amount + ' 万' : '-' }}</el-descriptions-item>
                  <el-descriptions-item label="客户">{{ inst?.customer_name }}</el-descriptions-item>
                  <el-descriptions-item label="客户联系人">{{ inst?.customer_contact || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="合同号" :span="2">{{ inst?.contract_no || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="工地位置" :span="2">{{ inst?.site_location || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="合同签订">{{ inst?.start_date || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="计划工期">{{ (inst?.planned_start || '-') + ' → ' + (inst?.planned_end || '-') }}</el-descriptions-item>
                </el-descriptions>
              </el-card>
            </el-col>
            <el-col :span="10">
              <el-card title="项目统计">
                <el-row :gutter="12">
                  <el-col :span="12">
                    <div class="stat-card" style="text-align: center; padding: 16px">
                      <div class="stat-value">{{ dash?.bom_count || 0 }}</div>
                      <div class="stat-label">BOM 节点</div>
                    </div>
                  </el-col>
                  <el-col :span="12">
                    <div class="stat-card" style="text-align: center; padding: 16px">
                      <div class="stat-value" style="color: #f56c6c">{{ dash?.key_component_count || 0 }}</div>
                      <div class="stat-label">关键件</div>
                    </div>
                  </el-col>
                  <el-col :span="12" style="margin-top: 12px">
                    <div class="stat-card" style="text-align: center; padding: 16px">
                      <div class="stat-value" style="color: #409eff">{{ dash?.work_orders?.in_progress || 0 }}</div>
                      <div class="stat-label">工单进行中</div>
                    </div>
                  </el-col>
                  <el-col :span="12" style="margin-top: 12px">
                    <div class="stat-card" style="text-align: center; padding: 16px">
                      <div class="stat-value" style="color: #67c23a">{{ dash?.work_orders?.completed || 0 }}</div>
                      <div class="stat-label">工单已完成</div>
                    </div>
                  </el-col>
                </el-row>
              </el-card>
            </el-col>
          </el-row>
        </el-tab-pane>

        <!-- BOM 树 -->
        <el-tab-pane :label="`BOM 树 (${dash?.bom_count || 0})`" name="bom">
          <el-card>
            <el-input v-model="bomFilter" placeholder="搜索零件..." size="small" style="margin-bottom: 12px; width: 300px" clearable />
            <el-tree
              :data="filteredBom"
              :props="{ label: 'label', children: 'children' }"
              node-key="id"
              default-expand-all
              :filter-node-method="filterNode"
              ref="treeRef"
            >
              <template #default="{ node, data }">
                <span style="display: flex; align-items: center; gap: 8px; width: 100%">
                  <span v-if="data.material_id" style="flex: 1">{{ data.material_name || '(未命名物料)' }}</span>
                  <span v-else style="flex: 1; font-weight: 500">{{ data.notes || data.code || '(未命名)' }}</span>
                  <el-tag v-if="data.is_key_component" type="danger" size="small">⭐ 关键</el-tag>
                  <span style="color: #909399; font-size: 12px">qty={{ data.quantity }}</span>
                </span>
              </template>
            </el-tree>
          </el-card>
        </el-tab-pane>

        <!-- 里程碑 -->
        <el-tab-pane :label="`里程碑 (${dash?.milestones?.length || 0})`" name="milestones">
          <el-card>
            <el-timeline>
              <el-timeline-item
                v-for="m in dash?.milestones || []"
                :key="m.id"
                :timestamp="m.planned_start"
                placement="top"
                :type="m.status === 'completed' ? 'success' : (m.status === 'active' ? 'primary' : 'info')"
              >
                <el-card shadow="never">
                  <div style="display: flex; justify-content: space-between">
                    <div>
                      <span style="font-weight: 600">{{ m.phase_code }} · {{ m.phase_name }}</span>
                      <el-tag size="small" :class="'milestone-tag milestone-' + m.status" style="margin-left: 8px">{{ m.status }}</el-tag>
                    </div>
                    <div style="color: #909399; font-size: 13px">
                      计划: {{ m.planned_start || '-' }} → {{ m.planned_end || '-' }}
                    </div>
                  </div>
                </el-card>
              </el-timeline-item>
            </el-timeline>
          </el-card>
        </el-tab-pane>

        <!-- 工单 -->
        <el-tab-pane :label="`工单 (${dash?.work_orders?.total || 0})`" name="work-orders">
          <el-card>
            <el-table :data="workOrders" stripe size="small">
              <el-table-column prop="wo_code" label="工单号" width="160" />
              <el-table-column prop="subsystem_name" label="子系统" width="100" />
              <el-table-column prop="title" label="标题" min-width="200" />
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="woStatusTagType(row.status)" size="small">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="priority" label="优先级" width="80" />
              <el-table-column label="计划开始" width="110">
                <template #default="{ row }">{{ row.planned_start || '-' }}</template>
              </el-table-column>
              <el-table-column label="实际开始" width="170">
                <template #default="{ row }">{{ row.actual_start || '-' }}</template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import { Api } from '../api'

const route = useRoute()
const id = computed(() => Number(route.params.id))
const loading = ref(false)
const tab = ref('overview')

const inst = ref<any>(null)
const dash = ref<any>(null)
const bomTree = ref<any[]>([])
const bomFlat = ref<any[]>([])
const workOrders = ref<any[]>([])
const materials = ref<any[]>([])
const bomFilter = ref('')
const treeRef = ref()

const statusLabel = (s: string) => ({ design: '设计', procurement: '采购', manufacturing: '生产', assembly: '装配', commissioning: '调试', shipping: '发运', accepted: '已验收' }[s] || s)
const statusTagType = (s: string) => ({ design: 'info', procurement: 'warning', manufacturing: 'primary', assembly: 'primary', commissioning: 'success', shipping: 'warning', accepted: 'success' }[s] || 'info')
const woStatusTagType = (s: string) => ({ pending: 'info', in_progress: 'primary', paused: 'warning', completed: 'success', issue: 'danger', rework: 'danger' }[s] || 'info')

const matName = (id: number) => materials.value.find((m: any) => m.id === id)?.material_name

// 转换 BOM 树，加 label 和 material_name
const decorateBom = (nodes: any[]): any[] => nodes.map(n => ({
  ...n,
  label: n.material_id ? (matName(n.material_id) || `物料#${n.material_id}`) : (n.notes || `节点#${n.id}`),
  material_name: n.material_id ? matName(n.material_id) : null,
  children: n.children ? decorateBom(n.children) : []
}))

const filteredBom = ref<any[]>([])

const filterNode = (value: any, data: any) => {
  if (!value) return true
  return (data.material_name && data.material_name.includes(value)) || (data.notes && data.notes.includes(value))
}

const load = async () => {
  loading.value = true
  try {
    const [i, d, bom, wo, mats] = await Promise.all([
      Api.instance(id.value),
      Api.instanceDashboard(id.value),
      Api.instanceBomTree(id.value),
      Api.workOrders({ equipment_instance_id: id.value }),
      Api.materials()
    ])
    inst.value = i
    dash.value = d
    bomFlat.value = bom
    workOrders.value = wo
    materials.value = mats
    const decorated = decorateBom(bom)
    filteredBom.value = decorated
    await new Promise(r => setTimeout(r, 100))
    treeRef.value?.filter(bomFilter.value)
  } finally {
    loading.value = false
  }
}

watch(bomFilter, (val) => treeRef.value?.filter(val))

onMounted(load)
</script>

<style scoped>
.bom-tree :deep(.el-tree-node__content) { height: 32px; }
</style>
