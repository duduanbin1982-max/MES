<template>
  <div class="unit-tab">
    <el-card shadow="never" class="unit-card">
      <template #header>
        <div class="unit-toolbar">
          <div>
            <div class="unit-title">物料单位换算</div>
            <div class="unit-subtitle">用于卷、箱、米、千克、件等采购/库存/领料单位之间的统一换算。</div>
          </div>
          <div class="unit-actions">
            <el-select
              v-model="selectedMaterialId"
              filterable
              clearable
              placeholder="选择物料"
              style="width: 320px"
              @change="loadUnits"
            >
              <el-option
                v-for="material in materials"
                :key="material.id"
                :label="`${material.material_code} / ${material.material_name}`"
                :value="material.id"
              >
                <span>{{ material.material_code }}</span>
                <span class="option-muted">{{ material.material_name }} · 基准单位 {{ material.unit || '-' }}</span>
              </el-option>
            </el-select>
            <el-button @click="loadAll" :loading="loading">刷新</el-button>
            <el-button type="primary" @click="openCreate" :disabled="!selectedMaterialId">新增换算</el-button>
          </div>
        </div>
      </template>

      <el-alert
        v-if="selectedMaterial"
        type="info"
        :closable="false"
        show-icon
        class="unit-alert"
      >
        当前物料：{{ selectedMaterial.material_code }} / {{ selectedMaterial.material_name }}，库存基准单位：
        <strong>{{ selectedMaterial.unit || '-' }}</strong>
      </el-alert>

      <el-table :data="units" v-loading="loading" size="small" stripe>
        <el-table-column prop="from_unit" label="来源单位" width="120" />
        <el-table-column label="换算关系" min-width="220">
          <template #default="{ row }">
            <span class="formula">1 {{ row.from_unit }} = {{ numberText(row.factor) }} {{ row.to_unit }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="to_unit" label="目标单位" width="120" />
        <el-table-column prop="factor" label="系数" width="120" />
        <el-table-column prop="notes" label="备注" min-width="180" show-overflow-tooltip />
        <el-table-column prop="created_at" label="创建时间" width="170" />
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="danger" plain @click="removeUnit(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && selectedMaterialId && units.length === 0" description="该物料暂无单位换算规则" />
      <el-empty v-if="!loading && !selectedMaterialId" description="请先选择一个物料查看单位换算" />
    </el-card>

    <el-dialog v-model="dialogVisible" title="新增单位换算" width="520px" @closed="resetForm">
      <el-form :model="form" label-width="96px">
        <el-form-item label="物料">
          <el-select v-model="form.material_id" filterable style="width:100%" placeholder="选择物料">
            <el-option
              v-for="material in materials"
              :key="material.id"
              :label="`${material.material_code} / ${material.material_name}`"
              :value="material.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="来源单位">
          <el-input v-model="form.from_unit" placeholder="例如：箱、卷、根、吨" />
        </el-form-item>
        <el-form-item label="目标单位">
          <el-input v-model="form.to_unit" placeholder="例如：件、米、千克" />
        </el-form-item>
        <el-form-item label="换算系数">
          <el-input-number v-model="form.factor" :min="0.000001" :precision="6" style="width:100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.notes" type="textarea" :rows="3" placeholder="例如：1 箱 = 100 件，用于采购整箱入库" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import Api from '../../api'

defineProps<{ tab: string }>()

const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const materials = ref<any[]>([])
const units = ref<any[]>([])
const selectedMaterialId = ref<number | null>(null)
const form = reactive({
  material_id: null as number | null,
  from_unit: '',
  to_unit: '',
  factor: 1,
  notes: '',
})

const selectedMaterial = computed(() => materials.value.find((item) => item.id === selectedMaterialId.value))

function numberText(value: any) {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
}

async function loadMaterials() {
  materials.value = await Api.materials()
  if (!selectedMaterialId.value && materials.value.length) {
    selectedMaterialId.value = materials.value[0].id
  }
}

async function loadUnits() {
  if (!selectedMaterialId.value) {
    units.value = []
    return
  }
  const result = await Api.get(`/materials/${selectedMaterialId.value}/units`)
  units.value = Array.isArray(result?.items) ? result.items : []
}

async function loadAll() {
  loading.value = true
  try {
    await loadMaterials()
    await loadUnits()
  } finally {
    loading.value = false
  }
}

function openCreate() {
  form.material_id = selectedMaterialId.value
  dialogVisible.value = true
}

function resetForm() {
  Object.assign(form, {
    material_id: selectedMaterialId.value,
    from_unit: '',
    to_unit: selectedMaterial.value?.unit || '',
    factor: 1,
    notes: '',
  })
}

async function submit() {
  if (!form.material_id || !form.from_unit || !form.to_unit || !form.factor) {
    ElMessage.warning('请填写物料、来源单位、目标单位和换算系数')
    return
  }
  if (form.from_unit === form.to_unit) {
    ElMessage.warning('来源单位和目标单位不能相同')
    return
  }
  saving.value = true
  try {
    await Api.post('/material_units', { ...form })
    ElMessage.success('单位换算已保存')
    dialogVisible.value = false
    selectedMaterialId.value = form.material_id
    await loadUnits()
  } finally {
    saving.value = false
  }
}

async function removeUnit(row: any) {
  await ElMessageBox.confirm(`确认删除 ${row.from_unit} → ${row.to_unit} 的换算规则？`, '删除确认', { type: 'warning' })
  await Api.delete(`/material_units/${row.id}`)
  ElMessage.success('已删除')
  await loadUnits()
}

onMounted(loadAll)
</script>

<style scoped>
.unit-tab {
  display: grid;
  gap: 14px;
}

.unit-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.unit-title {
  color: var(--el-text-color-primary);
  font-size: 16px;
  font-weight: 760;
}

.unit-subtitle {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.unit-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.option-muted {
  float: right;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.unit-alert {
  margin-bottom: 12px;
}

.formula {
  color: var(--el-color-primary);
  font-family: "Fira Code", "Cascadia Code", monospace;
  font-weight: 700;
}

@media (max-width: 768px) {
  .unit-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .unit-actions {
    justify-content: flex-start;
  }
}
</style>
