<template>
  <div class="page">
    <div class="page-header">
      <div>
        <span class="page-title">🌳 BOM 管理</span>
        <el-tag size="small" type="info" style="margin-left: 12px">4 级拆分法 · 12 字段 · ECO 追溯</el-tag>
      </div>
      <div>
        <el-select v-model="instanceId" placeholder="选择设备实例" filterable style="width: 280px; margin-right: 8px" @change="loadAll">
          <el-option v-for="i in instances" :key="i.id" :label="`${i.instance_code} · ${i.instance_name}`" :value="i.id" />
        </el-select>
        <el-button @click="loadAll" :disabled="!instanceId">刷新</el-button>
      </div>
    </div>

    <el-row :gutter="12" v-if="instanceId">
      <!-- 顶部 4 级统计卡 -->
      <el-col :span="6">
        <el-card class="level-card" :class="{ active: activeLevel === 0 }" @click="setLevel(0)" shadow="hover">
          <div class="level-num" style="color: #f56c6c">{{ summary[0] || 0 }}</div>
          <div class="level-label">0 级 · 总装</div>
          <div class="level-tip">整台设备 (1 个根)</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="level-card" :class="{ active: activeLevel === 1 }" @click="setLevel(1)" shadow="hover">
          <div class="level-num" style="color: #e6a23c">{{ summary[1] || 0 }}</div>
          <div class="level-label">1 级 · 部件/模组</div>
          <div class="level-tip">装配班组按部件领料</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="level-card" :class="{ active: activeLevel === 2 }" @click="setLevel(2)" shadow="hover">
          <div class="level-num" style="color: #409eff">{{ summary[2] || 0 }}</div>
          <div class="level-label">2 级 · 零件与外购件</div>
          <div class="level-tip">采购下单 / 加工领料</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="level-card" :class="{ active: activeLevel === 3 }" @click="setLevel(3)" shadow="hover">
          <div class="level-num" style="color: #67c23a">{{ summary[3] || 0 }}</div>
          <div class="level-label">3 级 · 原材料毛坯</div>
          <div class="level-tip">生产下料</div>
        </el-card>
      </el-col>
    </el-row>

    <el-tabs v-model="mainTab" v-if="instanceId" style="margin-top: 12px">
      <!-- Tab 1: 总览 (树状) -->
      <el-tab-pane label="🌲 总览 (树状)" name="tree">
        <div style="display: flex; gap: 12px; margin-bottom: 8px">
          <el-button size="small" type="primary" @click="dlgAdd = true; editingNode = null">+ 新增根节点</el-button>
          <el-button size="small" @click="dlgImport = true">📥 CSV 导入</el-button>
          <el-button size="small" type="warning" @click="doValidate">🔍 校验</el-button>
          <el-button size="small" type="success" @click="dlgCompare = true">🔄 ECO 对比</el-button>
          <el-input v-model="treeFilter" placeholder="搜索零件/图号/物料名" size="small" style="width: 240px; margin-left: auto" clearable />
        </div>
        <el-row :gutter="12">
          <el-col :span="10">
            <el-card>
              <el-tree
                v-if="tree.length"
                :data="filteredTree"
                :props="{ label: 'label', children: 'children' }"
                node-key="id"
                default-expand-all
                highlight-current
                @node-click="onNodeClick"
                style="max-height: 700px; overflow: auto"
              >
                <template #default="{ data }">
                  <span style="display: inline-flex; align-items: center; gap: 6px; width: 100%">
                    <el-tag v-if="data.tier === 0" size="small" type="danger">总装</el-tag>
                    <el-tag v-else-if="data.tier === 1" size="small" type="warning">部件</el-tag>
                    <el-tag v-else-if="data.tier === 2" size="small" type="info">零件</el-tag>
                    <el-tag v-else size="small">毛坯</el-tag>
                    <el-tag v-if="data.is_phantom" size="small">虚</el-tag>
                    <el-tag v-if="data.is_wear_part" size="small" type="warning">易损</el-tag>
                    <el-tag v-if="data.is_key_component" size="small" type="danger">关键</el-tag>
                    <span style="font-weight: 500">{{ data.material_name || data.part_number || '(未命名)' }}</span>
                    <span style="color: #909399; font-size: 12px">×{{ data.quantity }}{{ data.unit }}</span>
                    <el-button size="small" type="primary" link @click.stop="openAddChild(data)">+子</el-button>
                  </span>
                </template>
              </el-tree>
              <el-empty v-else description="该设备无 BOM 数据" />
            </el-card>
          </el-col>
          <el-col :span="14">
            <el-card style="margin-bottom: 12px">
              <template #header>
                <div style="display: flex; align-items: center; justify-content: space-between">
                  <span>💰 成本汇总 (MRP 自底向上)</span>
                  <el-tag :type="totalCost > 0 ? 'success' : 'info'" size="default">总成本: ¥{{ totalCost.toFixed(2) }}</el-tag>
                </div>
              </template>
              <el-table :data="costs" size="small" max-height="200" empty-text="该 BOM 无 unit_price, 成本全为 0">
                <el-table-column prop="id" label="ID" width="50" />
                <el-table-column label="物料" min-width="160">
                  <template #default="{ row }">{{ row.material_name || '(无)' }} <span style="color: #909399; font-size: 11px">{{ row.material_code }}</span></template>
                </el-table-column>
                <el-table-column prop="is_phantom" label="虚项" width="50">
                  <template #default="{ row }">{{ row.is_phantom ? '✓' : '' }}</template>
                </el-table-column>
                <el-table-column prop="self" label="自身" width="80" :formatter="(r) => r.self.toFixed(2)" />
                <el-table-column prop="cost" label="累计" width="80" :formatter="(r) => r.cost.toFixed(2)" />
              </el-table>
            </el-card>
            <el-card v-if="selected">
              <template #header>
                <div style="display: flex; align-items: center; justify-content: space-between">
                  <span>🔍 节点详情 #{{ selected.id }} ({{ tierName(selected.tier) }})</span>
                  <div>
                    <el-button size="small" @click="openEdit">编辑</el-button>
                    <el-button size="small" type="danger" @click="doDelete(selected)">删除</el-button>
                  </div>
                </div>
              </template>
              <el-descriptions :column="2" border size="small">
                <el-descriptions-item label="物料">{{ selected.material_name || '-' }} ({{ selected.material_code || '-' }})</el-descriptions-item>
                <el-descriptions-item label="图号/型号">{{ selected.part_number || '-' }}</el-descriptions-item>
                <el-descriptions-item label="数量">{{ selected.quantity }} {{ selected.unit }}</el-descriptions-item>
                <el-descriptions-item label="分类">{{ selected.category || '-' }}</el-descriptions-item>
                <el-descriptions-item label="材质">{{ selected.material_grade || '-' }}</el-descriptions-item>
                <el-descriptions-item label="表面处理">{{ selected.surface_treatment || '-' }}</el-descriptions-item>
                <el-descriptions-item label="品牌">{{ selected.brand_recommend || '-' }} ({{ selected.brand_grade || '-' }})</el-descriptions-item>
                <el-descriptions-item label="损耗">{{ selected.scrap_factor || 1.0 }}</el-descriptions-item>
                <el-descriptions-item label="单价/单重">{{ selected.unit_price || '-' }} 元 / {{ selected.weight || '-' }} kg</el-descriptions-item>
                <el-descriptions-item label="版本">{{ selected.version || '-' }}</el-descriptions-item>
                <el-descriptions-item label="关键/易损/虚项">
                  {{ selected.is_key_component ? '关键 ' : '' }}{{ selected.is_wear_part ? '易损 ' : '' }}{{ selected.is_phantom ? '虚项' : '' }}
                </el-descriptions-item>
                <el-descriptions-item label="替代">{{ selected.is_alternative ? `组 ${selected.alternative_group} 优先 ${selected.alternative_priority}` : '-' }}</el-descriptions-item>
                <el-descriptions-item label="存放位置">{{ selected.storage_location || '-' }}</el-descriptions-item>
                <el-descriptions-item label="ECO">{{ selected.eco_id ? '#' + selected.eco_id : '-' }}</el-descriptions-item>
                <el-descriptions-item label="生效期" :span="2">
                  {{ selected.effective_from || '-' }} → {{ selected.effective_to || '长期' }}
                </el-descriptions-item>
                <el-descriptions-item label="备注" :span="2">{{ selected.notes || '-' }}</el-descriptions-item>
              </el-descriptions>
            </el-card>
            <el-empty v-else description="点击左侧树节点查看详情" />
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- Tab 2: 0 总装 (1 个根) -->
      <el-tab-pane :label="`总装 (${summary[0] || 0})`" name="l0">
        <LevelTable :rows="rowsOfLevel(0)" :tier="0" @select="onRowSelect" @add="dlgAdd = true; editingNode = null; prefillTier(0)" @delete="doDelete" />
      </el-tab-pane>

      <!-- Tab 3: 1 部件 (装配班组) -->
      <el-tab-pane :label="`部件 (${summary[1] || 0})`" name="l1">
        <LevelTable :rows="rowsOfLevel(1)" :tier="1" @select="onRowSelect" @add="prefillTier(1); dlgAdd = true" @delete="doDelete" @drill="drillPart" />
        <el-card v-if="drillNode" style="margin-top: 12px">
          <template #header>
            <div style="display: flex; align-items: center; justify-content: space-between">
              <span>🔍 部件 "{{ drillNode.material_name || drillNode.part_number }}" 下子件 ({{ drillChildren.length }} 项)</span>
              <el-button size="small" @click="drillNode = null">收起</el-button>
            </div>
          </template>
          <LevelTable :rows="drillChildren" :tier="2" :show-actions="false" />
        </el-card>
      </el-tab-pane>

      <!-- Tab 4: 2 零件 (采购/加工) -->
      <el-tab-pane :label="`零件 (${summary[2] || 0})`" name="l2">
        <LevelTable :rows="rowsOfLevel(2)" :tier="2" @select="onRowSelect" @delete="doDelete" />
      </el-tab-pane>

      <!-- Tab 5: 3 毛坯 (生产下料) -->
      <el-tab-pane :label="`毛坯 (${summary[3] || 0})`" name="l3">
        <LevelTable :rows="rowsOfLevel(3)" :tier="3" @select="onRowSelect" @delete="doDelete" />
      </el-tab-pane>
    </el-tabs>
    <el-empty v-else description="请先选择设备实例" />

    <!-- 新增/编辑对话框 (同前, 略) -->
    <el-dialog v-model="dlgAdd" :title="editingNode ? `编辑节点 #${editingNode.id}` : '新增 BOM 节点'" width="700px" @closed="resetAddForm">
      <el-form :model="addForm" label-width="100px" size="small">
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="层级" required>
              <el-select v-model="addForm.tier" @change="onTierChange">
                <el-option label="0 总装" :value="0" />
                <el-option label="1 部件" :value="1" />
                <el-option label="2 零件" :value="2" />
                <el-option label="3 毛坯" :value="3" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="父节点">
              <el-select v-model="addForm.parent_id" filterable clearable style="width: 100%">
                <el-option v-for="p in allNodes" :key="p.id" :label="`#${p.id} ${p.material_name || ''} (tier ${p.tier})`" :value="p.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="物料" v-if="addForm.tier > 0">
              <el-select v-model="addForm.material_id" filterable clearable style="width: 100%">
                <el-option v-for="m in materials" :key="m.id" :label="`${m.material_code} · ${m.material_name}`" :value="m.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8"><el-form-item label="数量" required><el-input-number v-model="addForm.quantity" :min="0.0001" :step="1" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="单位" required><el-select v-model="addForm.unit"><el-option v-for="u in ['件','个','米','千克','套','台','根','条','升']" :key="u" :label="u" :value="u" /></el-select></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="分类" required><el-select v-model="addForm.category"><el-option v-for="c in ['自制机加件','自制钣金件','标准紧固件','气动元件','电气元件','外购成品','辅助材料','成品','自制部件']" :key="c" :label="c" :value="c" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="图号/型号"><el-input v-model="addForm.part_number" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="材质"><el-input v-model="addForm.material_grade" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="表面处理"><el-input v-model="addForm.surface_treatment" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="品牌/等级"><el-input v-model="addForm.brand_recommend" v-if="addForm.brand_grade === '不可替代'" placeholder="不可替代" disabled /><el-input v-model="addForm.brand_recommend" v-else placeholder="东明" /><el-select v-model="addForm.brand_grade" size="small" style="width: 90px; margin-left: 4px"><el-option label="A" value="A" /><el-option label="B" value="B" /><el-option label="不可" value="不可替代" /></el-select></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="损耗"><el-input-number v-model="addForm.scrap_factor" :min="1.0" :max="2.0" :step="0.05" :precision="2" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="单价"><el-input-number v-model="addForm.unit_price" :min="0" :precision="2" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="存放"><el-input v-model="addForm.storage_location" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="标识"><el-checkbox v-model="addForm.is_phantom">虚项</el-checkbox><el-checkbox v-model="addForm.is_key_component">关键</el-checkbox><el-checkbox v-model="addForm.is_wear_part">易损</el-checkbox></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="备注"><el-input v-model="addForm.notes" type="textarea" :rows="2" /></el-form-item></el-col>
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
      <el-input v-model="csvText" type="textarea" :rows="10" placeholder="tier,parent_id,material_id,quantity,unit,category,material_grade,scrap_factor" />
      <template #footer>
        <el-button @click="dlgImport = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="doImport">导入</el-button>
      </template>
    </el-dialog>

    <!-- 校验对话框 -->
    <el-dialog v-model="dlgValidate" title="校验结果" width="700px">
      <el-alert v-if="validateResult?.ok" type="success" :closable="false">✅ 校验通过 ({{ validateResult?.total || 0 }} 节点)</el-alert>
      <el-alert v-else type="error" :closable="false">{{ (validateResult?.errors || []).length }} 项错误</el-alert>
      <ul style="margin-top: 12px"><li v-for="(e, i) in validateResult?.errors || []" :key="i">{{ e }}</li></ul>
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
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import LevelTable from './bom/LevelTable.vue'

const instances = ref<any[]>([])
const instanceId = ref<number | null>(null)
const summary = ref<any>({ 0: 0, 1: 0, 2: 0, 3: 0, total: 0 })
const tree = ref<any[]>([])
const flat = ref<any[]>([])  // 平铺, 用于按 tier 过滤
const costs = ref<any[]>([])
const materials = ref<any[]>([])
const treeFilter = ref('')
const selected = ref<any | null>(null)
const activeLevel = ref<number | null>(null)
const mainTab = ref('tree')
const totalCost = computed(() => costs.value.reduce((s, c) => s + (c.cost || 0), 0))
const allNodes = computed(() => flat.value)

// 按层级取节点
function rowsOfLevel(t: number) {
  return flat.value.filter(r => r.tier === t)
}

const filteredTree = computed(() => {
  if (!treeFilter.value) return tree.value
  const q = treeFilter.value.toLowerCase()
  const match = (n: any): boolean => {
    if ((n.material_name || '').toLowerCase().includes(q)) return true
    if ((n.material_code || '').toLowerCase().includes(q)) return true
    if ((n.part_number || '').toLowerCase().includes(q)) return true
    return n.children?.some(match) || false
  }
  return tree.value.filter((r: any) => match(r))
})

async function loadAll() {
  if (!instanceId.value) return
  try {
    const [treeR, levelsR, costR, matsR] = await Promise.all([
      api.get(`/equipment_instances/${instanceId.value}/bom?view=tree`),
      api.get(`/equipment_instances/${instanceId.value}/bom/levels`),
      api.get(`/equipment_instances/${instanceId.value}/bom/cost`),
      api.get(`/materials?limit=500`).catch(() => ({ items: [] })),
    ])
    tree.value = treeR.tree || []
    summary.value = treeR.tier_summary || levelsR.summary
    // 把 4 级扁平合并成一个数组
    flat.value = []
    for (let i = 0; i <= 3; i++) flat.value.push(...(levelsR.levels?.[i] || []))
    costs.value = costR.items || []
    materials.value = matsR.items || []
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

function setLevel(t: number) {
  activeLevel.value = t
  mainTab.value = ['tree', 'l0', 'l1', 'l2', 'l3'][t] || 'tree'
}

function tierName(t: number) {
  return ['0 总装', '1 部件', '2 零件', '3 毛坯'][t] || t
}

function onNodeClick(node: any) { selected.value = node }
function onRowSelect(row: any) { selected.value = row }

function prefillTier(t: number) {
  resetAddForm()
  addForm.value.tier = t
  if (t === 0) { addForm.value.category = '成品' }
  if (t === 1) { addForm.value.category = '自制部件' }
  if (t === 2) { addForm.value.category = '外购成品' }
}

function onTierChange(t: number) {
  if (t === 0) addForm.value.category = '成品'
  else if (t === 1) addForm.value.category = '自制部件'
  else if (t === 2) addForm.value.category = '外购成品'
  else if (t === 3) addForm.value.category = '自制机加件'
}

// 部件下钻: 看某部件的子件
const drillNode = ref<any | null>(null)
const drillChildren = ref<any[]>([])
function drillPart(node: any) {
  drillNode.value = node
  drillChildren.value = flat.value.filter(r => r.parent_id === node.id)
}

// 对话框状态
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
    notes: '', parent_id: null,
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
  onTierChange(addForm.value.tier)
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
    if (drillNode.value?.id === node.id) drillNode.value = null
    await loadAll()
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error('删除失败: ' + (e.message || e))
  }
}

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

const validateResult = ref<any>(null)
async function doValidate() {
  const r: any = await api.get(`/equipment_instances/${instanceId.value}/bom/validate`)
  validateResult.value = r
  dlgValidate.value = true
  if (r.ok) ElMessage.success('校验通过')
  else ElMessage.warning(`${r.errors.length} 项错误`)
}

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

onMounted(loadInstances)
</script>

<style scoped>
.page { padding: 16px; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.page-title { font-size: 18px; font-weight: 600; }
.level-card { cursor: pointer; text-align: center; transition: all .2s; }
.level-card.active { box-shadow: 0 0 0 2px #409eff inset; }
.level-num { font-size: 28px; font-weight: 600; }
.level-label { font-size: 14px; font-weight: 500; margin-top: 4px; }
.level-tip { font-size: 12px; color: #909399; margin-top: 2px; }
:deep(.el-tree-node__content) { height: 32px; }
</style>
