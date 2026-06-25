<template>
  <div class="page">
    <div class="page-header">
      <div>
        <span class="page-title">🌳 BOM 管理 (P2 全面升级)</span>
        <el-tag size="small" type="info" style="margin-left: 12px">4 级结构 · 12 字段 · ECO 追溯</el-tag>
      </div>
      <div>
        <el-select v-model="instanceId" placeholder="选择设备实例" filterable style="width: 280px; margin-right: 8px" @change="loadAll">
          <el-option v-for="i in instances" :key="i.id" :label="`${i.instance_code} · ${i.instance_name}`" :value="i.id" />
        </el-select>
        <el-button @click="loadAll" :disabled="!instanceId">刷新</el-button>
      </div>
    </div>

    <el-row :gutter="16" v-if="instanceId">
      <!-- 左: 树视图 -->
      <el-col :span="10">
        <el-card>
          <template #header>
            <div style="display: flex; align-items: center; justify-content: space-between">
              <span>📋 BOM 树 ({{ bom.length }} 节点)</span>
              <el-input v-model="treeFilter" placeholder="搜索零件/图号" size="small" style="width: 200px" clearable />
            </div>
          </template>
          <div style="margin-bottom: 8px; display: flex; gap: 8px; flex-wrap: wrap">
            <el-button size="small" type="primary" @click="dlgAdd = true; editingNode = null">+ 新增根</el-button>
            <el-button size="small" @click="dlgImport = true">📥 CSV 导入</el-button>
            <el-button size="small" type="warning" @click="doValidate">🔍 校验</el-button>
            <el-button size="small" type="success" @click="dlgCompare = true">🔄 ECO 对比</el-button>
          </div>
          <el-tree
            v-if="filteredBom.length"
            :data="filteredBom"
            :props="{ label: 'label', children: 'children' }"
            node-key="id"
            default-expand-all
            highlight-current
            @node-click="onNodeClick"
            style="max-height: 600px; overflow: auto"
          >
            <template #default="{ node, data }">
              <span style="display: inline-flex; align-items: center; gap: 6px; width: 100%">
                <el-tag v-if="data.tier === 0" size="small" type="danger">总装</el-tag>
                <el-tag v-else-if="data.tier === 1" size="small" type="warning">部件</el-tag>
                <el-tag v-else-if="data.tier === 2" size="small" type="info">零件</el-tag>
                <el-tag v-else size="small">毛坯</el-tag>
                <el-tag v-if="data.is_phantom" size="small" type="info">虚</el-tag>
                <el-tag v-if="data.is_wear_part" size="small" type="warning">易损</el-tag>
                <el-tag v-if="data.is_key_component" size="small" type="danger">关键</el-tag>
                <span style="font-weight: 500">{{ data.material_name || data.part_number || '(未命名)' }}</span>
                <span style="color: #909399; font-size: 12px">×{{ data.quantity }}{{ data.unit }}</span>
                <span v-if="data.material_code" style="color: #909399; font-size: 11px; margin-left: auto">{{ data.material_code }}</span>
                <el-button size="small" type="primary" link @click.stop="openAddChild(data)">+子</el-button>
                <el-button size="small" type="danger" link @click.stop="doDelete(data)">删</el-button>
              </span>
            </template>
          </el-tree>
          <el-empty v-else description="该设备无 BOM 数据" />
        </el-card>
      </el-col>

      <!-- 右: 详情 + 成本 -->
      <el-col :span="14">
        <el-card style="margin-bottom: 12px">
          <template #header>
            <div style="display: flex; align-items: center; justify-content: space-between">
              <span>💰 成本汇总</span>
              <el-tag :type="totalCost > 0 ? 'success' : 'info'" size="default">
                总成本: ¥{{ totalCost.toFixed(2) }}
              </el-tag>
            </div>
          </template>
          <el-table :data="costs" size="small" max-height="220" empty-text="该 BOM 无 unit_price 字段值, 成本全为 0">
            <el-table-column prop="id" label="ID" width="50" />
            <el-table-column label="物料" min-width="160">
              <template #default="{ row }">{{ row.material_name || '(无)' }} <span style="color: #909399; font-size: 11px">{{ row.material_code }}</span></template>
            </el-table-column>
            <el-table-column prop="is_phantom" label="虚项" width="50">
              <template #default="{ row }">{{ row.is_phantom ? '✓' : '' }}</template>
            </el-table-column>
            <el-table-column prop="self" label="自身成本" width="100" :formatter="(r) => r.self.toFixed(2)" />
            <el-table-column prop="cost" label="累计成本" width="100" :formatter="(r) => r.cost.toFixed(2)" />
          </el-table>
        </el-card>

        <el-card v-if="selected">
          <template #header>
            <div style="display: flex; align-items: center; justify-content: space-between">
              <span>🔍 节点详情 (#{{ selected.id }})</span>
              <div>
                <el-button size="small" @click="openEdit">编辑</el-button>
                <el-button size="small" type="danger" @click="doDelete(selected)">删除</el-button>
              </div>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="层级">{{ tierName(selected.tier) }}</el-descriptions-item>
            <el-descriptions-item label="版本">{{ selected.version || '-' }}</el-descriptions-item>
            <el-descriptions-item label="物料">{{ selected.material_name || '-' }} ({{ selected.material_code || '-' }})</el-descriptions-item>
            <el-descriptions-item label="图号/型号">{{ selected.part_number || '-' }}</el-descriptions-item>
            <el-descriptions-item label="数量">{{ selected.quantity }} {{ selected.unit }}</el-descriptions-item>
            <el-descriptions-item label="分类">{{ selected.category || '-' }}</el-descriptions-item>
            <el-descriptions-item label="材质">{{ selected.material_grade || '-' }}</el-descriptions-item>
            <el-descriptions-item label="表面处理">{{ selected.surface_treatment || '-' }}</el-descriptions-item>
            <el-descriptions-item label="推荐品牌">{{ selected.brand_recommend || '-' }} ({{ selected.brand_grade || '-' }})</el-descriptions-item>
            <el-descriptions-item label="损耗系数">{{ selected.scrap_factor || 1.0 }}</el-descriptions-item>
            <el-descriptions-item label="单价">{{ selected.unit_price || '-' }}</el-descriptions-item>
            <el-descriptions-item label="单重(kg)">{{ selected.weight || '-' }}</el-descriptions-item>
            <el-descriptions-item label="关键件">{{ selected.is_key_component ? '✓' : '' }}</el-descriptions-item>
            <el-descriptions-item label="易损件">{{ selected.is_wear_part ? '✓' : '' }}</el-descriptions-item>
            <el-descriptions-item label="虚项">{{ selected.is_phantom ? '✓ (无库存/MRP)' : '' }}</el-descriptions-item>
            <el-descriptions-item label="替代">{{ selected.is_alternative ? `组 ${selected.alternative_group} 优先级 ${selected.alternative_priority}` : '-' }}</el-descriptions-item>
            <el-descriptions-item label="存放位置">{{ selected.storage_location || '-' }}</el-descriptions-item>
            <el-descriptions-item label="ECO">{{ selected.eco_id ? `#${selected.eco_id}` : '-' }}</el-descriptions-item>
            <el-descriptions-item label="生效日期" :span="2">
              {{ selected.effective_from || '-' }} → {{ selected.effective_to || '长期' }}
            </el-descriptions-item>
            <el-descriptions-item label="备注" :span="2">{{ selected.notes || '-' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
        <el-empty v-else description="点击左侧树节点查看详情" />
      </el-col>
    </el-row>
    <el-empty v-else description="请先选择设备实例" />

    <!-- 新增/编辑对话框 -->
    <el-dialog v-model="dlgAdd" :title="editingNode ? `编辑节点 #${editingNode.id}` : '新增 BOM 节点'" width="640px" @closed="resetAddForm">
      <el-form :model="addForm" label-width="100px" size="small">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="层级" required>
              <el-select v-model="addForm.tier">
                <el-option label="0 总装" :value="0" />
                <el-option label="1 部件" :value="1" />
                <el-option label="2 零件" :value="2" />
                <el-option label="3 毛坯" :value="3" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="物料" v-if="addForm.tier > 0">
              <el-select v-model="addForm.material_id" filterable clearable style="width: 100%">
                <el-option v-for="m in materials" :key="m.id" :label="`${m.material_code} · ${m.material_name}`" :value="m.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="数量" required>
              <el-input-number v-model="addForm.quantity" :min="0.0001" :step="1" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="单位" required>
              <el-select v-model="addForm.unit">
                <el-option v-for="u in ['件','个','米','千克','套','台','根','条','升']" :key="u" :label="u" :value="u" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="分类" required>
              <el-select v-model="addForm.category">
                <el-option v-for="c in ['自制机加件','自制钣金件','标准紧固件','气动元件','电气元件','外购成品','辅助材料','成品','自制部件']" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="图号/型号"><el-input v-model="addForm.part_number" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="材质牌号"><el-input v-model="addForm.material_grade" placeholder="Q235B / 45钢 / 304不锈钢" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="表面处理"><el-input v-model="addForm.surface_treatment" placeholder="发黑 / 阳极氧化 / 喷塑RAL7035" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="推荐品牌"><el-input v-model="addForm.brand_recommend" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="品牌等级">
              <el-select v-model="addForm.brand_grade" clearable>
                <el-option label="A (顶级)" value="A" />
                <el-option label="B (合格)" value="B" />
                <el-option label="不可替代" value="不可替代" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="损耗系数">
              <el-input-number v-model="addForm.scrap_factor" :min="1.0" :max="2.0" :step="0.05" :precision="2" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="单价"><el-input-number v-model="addForm.unit_price" :min="0" :precision="2" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="存放位置"><el-input v-model="addForm.storage_location" /></el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="标识">
              <el-checkbox v-model="addForm.is_phantom">虚项 (无库存/MRP)</el-checkbox>
              <el-checkbox v-model="addForm.is_key_component">关键件</el-checkbox>
              <el-checkbox v-model="addForm.is_wear_part">易损件 (备件)</el-checkbox>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注"><el-input v-model="addForm.notes" type="textarea" :rows="2" placeholder="左件/右件/与XX配作/不可替代" /></el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dlgAdd = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- CSV 导入对话框 -->
    <el-dialog v-model="dlgImport" title="CSV 导入" width="700px">
      <el-alert type="info" :closable="false" style="margin-bottom: 12px">
        必填列: tier, quantity, unit, category<br>
        可选列: material_id, part_number, parent_id, material_grade, surface_treatment, brand_recommend, scrap_factor, is_phantom, is_key_component, is_wear_part, notes
      </el-alert>
      <el-input v-model="csvText" type="textarea" :rows="10" placeholder="tier,parent_id,material_id,quantity,unit,category,material_grade,surface_treatment,scrap_factor&#10;0,,,1,台,成品,,,,&#10;2,1,18,3,件,外购成品,Q345,喷塑RAL7035,1.05" />
      <template #footer>
        <el-button @click="dlgImport = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="doImport">导入</el-button>
      </template>
    </el-dialog>

    <!-- 校验结果对话框 -->
    <el-dialog v-model="dlgValidate" title="校验结果" width="700px">
      <el-alert v-if="validateResult?.ok" type="success" :closable="false">✅ 校验通过 ({{ validateResult?.total || 0 }} 节点)</el-alert>
      <el-alert v-else type="error" :closable="false">{{ (validateResult?.errors || []).length }} 项错误</el-alert>
      <el-table :data="validateResult?.errors || []" size="small" max-height="400" style="margin-top: 12px">
        <el-table-column prop="" label="#" type="index" width="50" />
        <el-table-column prop="" label="错误">
          <template #default="{ row }">{{ row }}</template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- ECO 对比对话框 -->
    <el-dialog v-model="dlgCompare" title="ECO 版本对比" width="600px">
      <el-form label-width="80px" size="small">
        <el-form-item label="旧版本"><el-input v-model="compareV1" /></el-form-item>
        <el-form-item label="新版本"><el-input v-model="compareV2" /></el-form-item>
        <el-button type="primary" @click="doCompare" :loading="comparing">对比</el-button>
      </el-form>
      <el-row :gutter="12" v-if="compareResult" style="margin-top: 16px">
        <el-col :span="8"><el-statistic title="新增" :value="compareResult.added.length" :value-style="{ color: '#67c23a' }" /></el-col>
        <el-col :span="8"><el-statistic title="删除" :value="compareResult.removed.length" :value-style="{ color: '#f56c6c' }" /></el-col>
        <el-col :span="8"><el-statistic title="修改" :value="compareResult.changed.length" :value-style="{ color: '#e6a23c' }" /></el-col>
      </el-row>
      <el-tabs v-if="compareResult" style="margin-top: 12px">
        <el-tab-pane :label="`新增 (${compareResult.added.length})`">
          <el-table :data="compareResult.added" size="small" max-height="200">
            <el-table-column prop="id" label="ID" width="50" />
            <el-table-column prop="tier" label="层级" width="60" />
            <el-table-column prop="part_number" label="图号" />
            <el-table-column prop="quantity" label="数量" width="80" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="`修改 (${compareResult.changed.length})`">
          <div v-for="c in compareResult.changed" :key="c.id" style="margin-bottom: 8px; padding: 8px; background: #f5f7fa; border-radius: 4px">
            <strong>#{{ c.id }}</strong>
            <div v-for="(d, k) in c" v-show="k !== 'id' && typeof d === 'object'" :key="k" style="font-size: 12px">
              <el-tag size="small" type="warning">{{ k }}</el-tag>
              <span style="margin: 0 6px; color: #f56c6c">{{ JSON.stringify(d.from) }}</span> →
              <span style="color: #67c23a">{{ JSON.stringify(d.to) }}</span>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const instances = ref<any[]>([])
const instanceId = ref<number | null>(null)
const bom = ref<any[]>([])
const costs = ref<any[]>([])
const materials = ref<any[]>([])
const treeFilter = ref('')
const selected = ref<any | null>(null)
const totalCost = computed(() => costs.value.reduce((s, c) => s + (c.cost || 0), 0))

// 转树
const filteredBom = computed(() => {
  const map = new Map<number, any>()
  const roots: any[] = []
  bom.value.forEach(b => { map.set(b.id, { ...b, children: [] }) })
  bom.value.forEach(b => {
    const node = map.get(b.id)
    if (b.parent_id && map.has(b.parent_id)) {
      map.get(b.parent_id).children.push(node)
    } else {
      roots.push(node)
    }
  })
  // 搜索过滤
  if (!treeFilter.value) return roots
  const q = treeFilter.value.toLowerCase()
  const match = (n: any): boolean =>
    (n.material_name || '').toLowerCase().includes(q) ||
    (n.material_code || '').toLowerCase().includes(q) ||
    (n.part_number || '').toLowerCase().includes(q) ||
    n.children?.some(match)
  return roots.filter((r: any) => match(r))
})

// 加载
async function loadAll() {
  if (!instanceId.value) return
  try {
    const [tree, cost, mats] = await Promise.all([
      api.get(`/equipment_instances/${instanceId.value}/bom`),
      api.get(`/equipment_instances/${instanceId.value}/bom/cost`),
      api.get(`/materials?limit=500`).catch(() => ({ items: [] })),
    ])
    bom.value = tree.items || []
    costs.value = cost.items || []
    materials.value = mats.items || []
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e.message || e))
  }
}

async function loadInstances() {
  const r: any = await api.get('/equipment_instances?limit=100')
  instances.value = r.items || r || []
  if (instances.value.length && !instanceId.value) {
    instanceId.value = instances.value[0].id
    await loadAll()
  }
}

// 对话框
const dlgAdd = ref(false)
const dlgImport = ref(false)
const dlgValidate = ref(false)
const dlgCompare = ref(false)
const saving = ref(false)
const importing = ref(false)
const comparing = ref(false)
const editingNode = ref<any | null>(null)
const addForm = ref<any>(defaultForm())
function defaultForm() {
  return {
    tier: 2, quantity: 1, unit: '件', category: '外购成品',
    material_id: null, part_number: '', material_grade: '',
    surface_treatment: '', brand_recommend: '', brand_grade: '',
    scrap_factor: 1.0, unit_price: null, storage_location: '',
    is_phantom: false, is_key_component: false, is_wear_part: false,
    notes: '',
  }
}
function resetAddForm() {
  editingNode.value = null
  addForm.value = defaultForm()
}

function openAddChild(parent: any) {
  resetAddForm()
  editingNode.value = { ...parent, _adding: true }
  addForm.value.parent_id = parent.id
  addForm.value.tier = Math.min(parent.tier + 1, 3)
  dlgAdd.value = true
}
function openEdit() {
  if (!selected.value) return
  editingNode.value = selected.value
  addForm.value = { ...defaultForm(), ...selected.value }
  dlgAdd.value = true
}

async function doSave() {
  saving.value = true
  try {
    if (editingNode.value && !editingNode.value._adding) {
      await api.put(`/bom/${editingNode.value.id}`, addForm.value)
      ElMessage.success(`已更新 #${editingNode.value.id}`)
    } else {
      const r: any = await api.post(`/equipment_instances/${instanceId.value}/bom`, {
        ...addForm.value,
        parent_id: addForm.value.parent_id || null,
      })
      ElMessage.success(`已新增 #${r.id}`)
    }
    dlgAdd.value = false
    await loadAll()
  } catch (e: any) {
    const msg = e.response?.data?.message || e.message
    const det = e.response?.data?.details
    ElMessage.error('保存失败: ' + msg + (det ? ' ' + JSON.stringify(det) : ''))
  } finally {
    saving.value = false
  }
}

async function doDelete(node: any) {
  try {
    await ElMessageBox.confirm(`确认删除节点 #${node.id} "${node.material_name || ''}" 及其所有子节点?`, '危险操作', { type: 'warning' })
    await api.delete(`/bom/${node.id}`)
    ElMessage.success('已删除')
    if (selected.value?.id === node.id) selected.value = null
    await loadAll()
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error('删除失败: ' + (e.message || e))
  }
}

function onNodeClick(node: any) { selected.value = node }

// CSV 导入
const csvText = ref('')
async function doImport() {
  importing.value = true
  try {
    const r: any = await api.post(`/equipment_instances/${instanceId.value}/bom/import`, { csv: csvText.value })
    ElMessage.success(`导入完成: ${r.inserted} 成功, ${r.errors} 失败`)
    dlgImport.value = false
    csvText.value = ''
    await loadAll()
  } catch (e: any) {
    ElMessage.error('导入失败: ' + (e.response?.data?.message || e.message))
  } finally {
    importing.value = false
  }
}

// 校验
const validateResult = ref<any>(null)
async function doValidate() {
  const r: any = await api.get(`/equipment_instances/${instanceId.value}/bom/validate`)
  validateResult.value = r
  dlgValidate.value = true
  if (r.ok) ElMessage.success('校验通过')
  else ElMessage.warning(`${r.errors.length} 项错误`)
}

// ECO 对比
const compareV1 = ref('A0')
const compareV2 = ref('A1')
const compareResult = ref<any>(null)
async function doCompare() {
  comparing.value = true
  try {
    compareResult.value = await api.get(`/equipment_instances/${instanceId.value}/bom/compare?v1=${compareV1.value}&v2=${compareV2.value}`)
  } catch (e: any) {
    ElMessage.error('对比失败: ' + (e.message || e))
  } finally {
    comparing.value = false
  }
}

function tierName(t: number) {
  return ['0 总装', '1 部件', '2 零件', '3 毛坯'][t] || t
}

onMounted(loadInstances)
watch(instanceId, () => loadAll())
</script>

<style scoped>
.page { padding: 16px; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.page-title { font-size: 18px; font-weight: 600; }
.el-card { margin-bottom: 0; }
:deep(.el-tree-node__content) { height: 32px; }
</style>
