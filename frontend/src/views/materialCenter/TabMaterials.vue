<template>
  <el-card shadow="never">
    <div class="mat-toolbar">
      <el-tree-select v-model="categoryId" :data="categoryTree" :props="{ label: 'category_name', value: 'id', children: 'children' }"
        check-strictly clearable placeholder="按分类筛选（含子类）" style="width: 300px" @change="loadMats" />
      <span class="mat-hint">选择大类会包含其下所有子类</span>
      <el-select v-model="sourceType" clearable placeholder="来源" style="width:120px" @change="loadMats">
        <el-option label="外购" value="purchased" /><el-option label="自制" value="self_made" /><el-option label="委外" value="outsourced" />
      </el-select>
      <el-select v-model="inventoryPolicy" clearable placeholder="库存策略" style="width:130px" @change="loadMats">
        <el-option label="常备" value="stock" /><el-option label="项目直供" value="project" /><el-option label="不库存" value="none" />
      </el-select>
      <el-select v-model="criticalityFilter" clearable placeholder="关键性" style="width:110px" @change="loadMats">
        <el-option label="普通" value="normal" /><el-option label="重要" value="important" /><el-option label="关键" value="critical" />
      </el-select>
      <el-select v-model="abcFilter" clearable placeholder="ABC" style="width:90px" @change="loadMats">
        <el-option label="A" value="A" /><el-option label="B" value="B" /><el-option label="C" value="C" />
      </el-select>
      <el-button type="primary" size="small" style="margin-left:auto" @click="openCreate">+ 新增物料</el-button>
    </div>
    <el-table :data="mats" stripe v-loading="loading" size="small">
      <el-table-column prop="material_code" label="编码" width="140" />
      <el-table-column prop="material_name" label="名称" min-width="200" />
      <el-table-column label="分类" width="170">
        <template #default="{ row }">
          <span v-if="row.category_name">{{ row.category_code }} {{ row.category_name }}</span>
          <span v-else class="mat-muted">未分类</span>
        </template>
      </el-table-column>
      <el-table-column prop="material_type" label="类型" width="100" />
      <el-table-column label="来源" width="80"><template #default="{ row }">{{ sourceLabel(row.source_type) }}</template></el-table-column>
      <el-table-column label="库存策略" width="100"><template #default="{ row }">{{ policyLabel(row.inventory_policy) }}</template></el-table-column>
      <el-table-column label="关键性" width="80"><template #default="{ row }">{{ criticalityLabel(row.criticality) }}</template></el-table-column>
      <el-table-column prop="abc_class" label="ABC" width="60" />
      <el-table-column prop="default_location" label="默认库位" width="120" />
      <el-table-column prop="spec" label="规格" width="150" />
      <el-table-column prop="unit" label="单位" width="60" />
      <el-table-column label="自制" width="70">
        <template #default="{ row }">
          <el-tag v-if="row.is_self_made" type="success" size="small">自制</el-tag>
          <el-tag v-else size="small">外购</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="关键件" width="80">
        <template #default="{ row }">
          <el-tag v-if="row.is_key_component" type="danger" size="small">⭐ 关键</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="default_supplier" label="默认供应商" width="140" />
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ row }"><el-button size="small" link type="primary" @click="openEdit(row)">编辑</el-button></template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="matDlg" :title="editingId ? '编辑物料' : '新增物料'" width="640px">
      <el-form :model="matForm" label-width="100px">
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="物料编码" required><el-input v-model="matForm.material_code" :disabled="!!editingId" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="物料名称" required><el-input v-model="matForm.material_name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="分类"><el-tree-select v-model="matForm.category_id" :data="categoryTree" :props="{ label: 'category_name', value: 'id', children: 'children' }" check-strictly clearable style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="类型"><el-input v-model="matForm.material_type" placeholder="steel / electrical / purchased..." /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="来源"><el-select v-model="matForm.source_type" style="width:100%"><el-option label="外购" value="purchased" /><el-option label="自制" value="self_made" /><el-option label="委外" value="outsourced" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="库存策略"><el-select v-model="matForm.inventory_policy" style="width:100%"><el-option label="常备" value="stock" /><el-option label="项目直供" value="project" /><el-option label="不库存" value="none" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="关键性"><el-select v-model="matForm.criticality" style="width:100%"><el-option label="普通" value="normal" /><el-option label="重要" value="important" /><el-option label="关键" value="critical" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="ABC 分类"><el-select v-model="matForm.abc_class" style="width:100%"><el-option label="A" value="A" /><el-option label="B" value="B" /><el-option label="C" value="C" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="默认库位"><el-input v-model="matForm.default_location" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="规格"><el-input v-model="matForm.spec" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="单位"><el-input v-model="matForm.unit" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="安全库存"><el-input-number v-model="matForm.safety_stock" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="再订货点"><el-input-number v-model="matForm.reorder_point" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="默认供应商"><el-input v-model="matForm.default_supplier" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="自制"><el-switch v-model="matForm.is_self_made" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="关键件"><el-switch v-model="matForm.is_key_component" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="批次管理"><el-switch v-model="matForm.lot_managed" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="备注"><el-input v-model="matForm.notes" type="textarea" :rows="2" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer><el-button @click="matDlg = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveMaterial">保存</el-button></template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../api'

defineProps<{ tab: string }>()
const mats = ref<any[]>([])
const loading = ref(false)
const categoryId = ref<number | null>(null)
const sourceType = ref('')
const inventoryPolicy = ref('')
const criticalityFilter = ref('')
const abcFilter = ref('')
const categories = ref<any[]>([])
const categoryTree = computed(() => {
  const map = new Map<number, any>()
  const roots: any[] = []
  for (const row of categories.value) map.set(row.id, { ...row, children: [] })
  for (const row of categories.value) {
    const node = map.get(row.id)
    const parent = row.parent_id ? map.get(row.parent_id) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
})
const loadMats = async () => {
  loading.value = true
  const params: any = {}
  if (categoryId.value) params.category_id = categoryId.value
  if (sourceType.value) params.source_type = sourceType.value
  if (inventoryPolicy.value) params.inventory_policy = inventoryPolicy.value
  if (criticalityFilter.value) params.criticality = criticalityFilter.value
  if (abcFilter.value) params.abc_class = abcFilter.value
  try { mats.value = await api.materials(Object.keys(params).length ? params : undefined) } catch(e) { /* 前端统一用 ElMessage 提示 */ } finally { loading.value = false }
}
const matDlg = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const emptyForm = () => ({ material_code: '', material_name: '', material_type: 'purchased', spec: '', unit: '件',
  category_id: null as number | null, source_type: 'purchased', inventory_policy: 'stock', criticality: 'normal', abc_class: 'C', default_location: '', is_self_made: false, is_key_component: false, lot_managed: false,
  safety_stock: 0, reorder_point: 0, default_supplier: '', notes: '' })
const matForm = reactive<any>(emptyForm())
const sourceLabel = (value: string) => ({ purchased: '外购', self_made: '自制', outsourced: '委外' } as any)[value] || value || '-'
const policyLabel = (value: string) => ({ stock: '常备', project: '项目直供', none: '不库存' } as any)[value] || value || '-'
const criticalityLabel = (value: string) => ({ normal: '普通', important: '重要', critical: '关键' } as any)[value] || value || '-'
function openCreate() { editingId.value = null; Object.assign(matForm, emptyForm()); matDlg.value = true }
function openEdit(row: any) {
  editingId.value = row.id
  Object.assign(matForm, {
    material_code: row.material_code, material_name: row.material_name, material_type: row.material_type || 'purchased',
    spec: row.spec || '', unit: row.unit || '件', category_id: row.category_id || null,
    source_type: row.source_type || 'purchased', inventory_policy: row.inventory_policy || 'stock',
    criticality: row.criticality || 'normal', abc_class: row.abc_class || 'C', default_location: row.default_location || '',
    is_self_made: !!row.is_self_made, is_key_component: !!row.is_key_component, lot_managed: !!row.lot_managed,
    safety_stock: Number(row.safety_stock || 0), reorder_point: Number(row.reorder_point || 0),
    default_supplier: row.default_supplier || '', notes: row.notes || '',
  })
  matDlg.value = true
}
async function saveMaterial() {
  if (!matForm.material_code || !matForm.material_name) return ElMessage.warning('编码和名称必填')
  saving.value = true
  try {
    const payload = { ...matForm, is_self_made: matForm.is_self_made ? 1 : 0, is_key_component: matForm.is_key_component ? 1 : 0, lot_managed: matForm.lot_managed ? 1 : 0 }
    if (editingId.value) await api.updateMaterial(editingId.value, payload)
    else await api.createMaterial(payload)
    ElMessage.success(editingId.value ? '物料已更新' : '物料已创建')
    matDlg.value = false
    await loadMats()
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || '保存失败') }
  finally { saving.value = false }
}
const load = async () => {
  try { categories.value = await api.materialCategories() } catch(e) { categories.value = [] }
  await loadMats()
}
onMounted(load)
</script>

<style scoped>
.mat-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.mat-hint { color: var(--el-text-color-secondary); font-size: 12px; }
.mat-muted { color: var(--el-text-color-placeholder); }
</style>