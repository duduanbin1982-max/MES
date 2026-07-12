<template>
  <el-card shadow="never">
    <template #header>
      <div class="head">
        <strong><el-icon><Download /></el-icon> Excel/CSV 导入与一物一码校验</strong>
        <div>
          <el-button size="small" @click="downloadTemplate">下载 CSV 模板</el-button>
          <el-button size="small" @click="loadDuplicates">一物一码查重</el-button>
        </div>
      </div>
    </template>

    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
      Excel 请先另存为 CSV 后导入。支持字段：material_code、material_name、material_type、spec、unit、is_key_component、is_self_made、default_supplier、safety_stock、reorder_point、estimated_unit_price、actual_unit_price、notes。
    </el-alert>

    <div class="toolbar">
      <el-upload :auto-upload="false" :show-file-list="false" accept=".csv,.txt" :on-change="onFile">
        <el-button type="primary">选择 CSV 文件</el-button>
      </el-upload>
      <el-button :loading="validating" @click="validateImport">校验预览</el-button>
      <el-button type="success" :disabled="!summary.total || summary.invalid > 0" :loading="committing" @click="commitImport">确认导入</el-button>
    </div>

    <el-input
      v-model="csvText"
      type="textarea"
      :rows="8"
      placeholder="也可以直接粘贴 CSV 内容..."
      style="margin-bottom: 12px"
    />

    <el-row :gutter="12" style="margin-bottom: 12px">
      <el-col :span="6"><el-card shadow="never"><el-statistic title="总行数" :value="summary.total || 0" /></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><el-statistic title="可导入" :value="summary.valid || 0" /></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><el-statistic title="错误" :value="summary.invalid || 0"><template #suffix><span style="color:var(--el-color-danger)">项</span></template></el-statistic></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><el-statistic title="警告" :value="summary.warnings || 0"><template #suffix><span style="color:var(--el-color-warning)">项</span></template></el-statistic></el-card></el-col>
    </el-row>

    <el-table v-if="items.length" :data="items" size="small" max-height="360" stripe>
      <el-table-column prop="row" label="行号" width="70" />
      <el-table-column label="编码" width="140"><template #default="{ row }">{{ row.material.material_code }}</template></el-table-column>
      <el-table-column label="名称" min-width="180"><template #default="{ row }">{{ row.material.material_name }}</template></el-table-column>
      <el-table-column label="类型" width="110"><template #default="{ row }">{{ row.material.material_type }}</template></el-table-column>
      <el-table-column label="规格" width="130"><template #default="{ row }">{{ row.material.spec || '-' }}</template></el-table-column>
      <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.valid ? 'success' : 'danger'" size="small">{{ row.valid ? '通过' : '错误' }}</el-tag></template></el-table-column>
      <el-table-column label="错误/警告" min-width="260">
        <template #default="{ row }">
          <el-tag v-for="e in row.errors" :key="'e'+e" type="danger" size="small" style="margin:2px">{{ e }}</el-tag>
          <el-tag v-for="w in row.warnings" :key="'w'+w" type="warning" size="small" style="margin:2px">{{ w }}</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <el-divider />
    <h4>一物一码重复检查</h4>
    <el-row :gutter="12">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>编码重复</template>
          <el-table :data="duplicates.code_duplicates || []" size="small" max-height="220">
            <el-table-column prop="material_code" label="物料编码" />
            <el-table-column prop="count" label="重复数" width="90" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>疑似一物多码</template>
          <el-table :data="duplicates.identity_duplicates || []" size="small" max-height="220">
            <el-table-column prop="material_name" label="名称" />
            <el-table-column prop="spec" label="规格" />
            <el-table-column prop="material_codes" label="编码列表" show-overflow-tooltip />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </el-card>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { ElMessage, type UploadFile } from 'element-plus'
import api from '../../api'

defineProps<{ tab: string }>()

const csvText = ref('')
const validating = ref(false)
const committing = ref(false)
const summary = reactive<any>({ total: 0, valid: 0, invalid: 0, warnings: 0 })
const items = ref<any[]>([])
const duplicates = ref<any>({ code_duplicates: [], identity_duplicates: [] })

async function onFile(file: UploadFile) {
  const raw = file.raw
  if (!raw) return
  csvText.value = await raw.text()
}

function samplePayload() {
  return { text: csvText.value }
}

async function validateImport() {
  if (!csvText.value.trim()) { ElMessage.warning('请先选择 CSV 文件或粘贴内容'); return }
  validating.value = true
  try {
    const result: any = await api.post('/materials/import/validate', samplePayload())
    Object.assign(summary, result)
    items.value = result.items || []
    ElMessage.success(`校验完成：可导入 ${result.valid} 行，错误 ${result.invalid} 行`)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e.message || '校验失败')
  } finally {
    validating.value = false
  }
}

async function commitImport() {
  committing.value = true
  try {
    const result: any = await api.post('/materials/import/commit', samplePayload())
    ElMessage.success(`导入完成：${result.created} 条`)
    await loadDuplicates()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e.message || '导入失败')
  } finally {
    committing.value = false
  }
}

async function loadDuplicates() {
  try { duplicates.value = await api.get('/material_duplicates') }
  catch (e: any) { ElMessage.error(e?.message || '查重失败') }
}

function downloadTemplate() {
  window.open('/api/materials/import/template', '_blank')
}

onMounted(loadDuplicates)
</script>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
</style>
