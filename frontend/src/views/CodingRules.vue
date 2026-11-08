<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div>
        <div class="page-title"><el-icon><DataAnalysis /></el-icon> 编码规则</div>
        <div class="page-subtitle">维护项目装备/模板编码的规则与序列；编码预览不会消耗序号，创建时会自动预留。</div>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="loadAll">刷新</el-button>
    </PageToolbar>

    <el-alert
      v-if="preview.code"
      type="success"
      :closable="false"
      show-icon
      class="preview-alert"
      :title="`预览编码：${preview.code}`"
    >
      <span class="hint">{{ preview.description || preview.rule_code }}</span>
    </el-alert>

    <el-row :gutter="16">
      <el-col :span="16">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>规则清单</span>
              <el-button v-if="canManage" size="small" type="primary" @click="openForm()">新建规则</el-button>
            </div>
          </template>
          <el-table :data="rules" size="small" v-loading="loading" @row-click="openForm">
            <el-table-column prop="rule_code" label="规则编码" width="170" />
            <el-table-column prop="name" label="名称" min-width="140" />
            <el-table-column prop="entity_type" label="对象" width="150" />
            <el-table-column prop="prefix" label="前缀" width="90" />
            <el-table-column label="格式" min-width="220">
              <template #default="{ row }">
                {{ row.prefix }}{{ row.separator }}{{ row.customer_mode === 'token' ? '客户' + row.separator : '' }}{{ row.year_mode === 'year' ? 'YYYY' + row.separator : '' }}###（至少 {{ row.sequence_width }} 位）
              </template>
            </el-table-column>
            <el-table-column label="启用" width="70">
              <template #default="{ row }"><el-tag :type="row.is_active ? 'success' : 'info'" size="small">{{ row.is_active ? '启用' : '停用' }}</el-tag></template>
            </el-table-column>
            <el-table-column v-if="canManage" label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button size="small" link type="primary" @click.stop="openPreview(row)">预览</el-button>
                <el-button size="small" link type="primary" @click.stop="openForm(row)">编辑</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card>
          <template #header><span>编码预览</span></template>
          <el-form label-width="82px" size="small">
            <el-form-item label="规则">
              <el-select v-model="previewRule" style="width:100%" @change="runPreview">
                <el-option v-for="rule in rules" :key="rule.rule_code" :label="rule.name" :value="rule.rule_code" />
              </el-select>
            </el-form-item>
            <el-form-item label="客户/分类"><el-input v-model="preview.customer" placeholder="如 郑州地铁集团 / TBM" @change="runPreview" /></el-form-item>
            <el-form-item label="年份"><el-input-number v-model="preview.year" :min="2020" :max="2099" style="width:100%" @change="runPreview" /></el-form-item>
            <el-form-item><el-button type="primary" :loading="previewLoading" @click="runPreview">生成预览</el-button></el-form-item>
          </el-form>
          <el-alert type="info" :closable="false" show-icon title="序列在创建时由后端原子递增；预览只读取下一个序号。" />
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="form.visible" :title="form.isEdit ? '编辑编码规则' : '新建编码规则'" width="680px">
      <el-form :model="form.data" label-width="110px" size="small">
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="规则编码" required><el-input v-model="form.data.rule_code" :disabled="form.isEdit" placeholder="equipment_instance" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="名称" required><el-input v-model="form.data.name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="对象类型"><el-select v-model="form.data.entity_type" style="width:100%"><el-option label="项目装备" value="equipment_instance" /><el-option label="项目模板" value="equipment_template" /><el-option label="通用" value="generic" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="前缀"><el-input v-model="form.data.prefix" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="分隔符"><el-select v-model="form.data.separator" style="width:100%"><el-option label="-" value="-" /><el-option label="_" value="_" /><el-option label="." value="." /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="年份模式"><el-select v-model="form.data.year_mode" style="width:100%"><el-option label="不包含" value="none" /><el-option label="年" value="year" /><el-option label="年月" value="month" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="客户段"><el-select v-model="form.data.customer_mode" style="width:100%"><el-option label="不包含" value="none" /><el-option label="客户/分类缩写" value="token" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="序号宽度"><el-input-number v-model="form.data.sequence_width" :min="1" :max="8" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="重置策略"><el-select v-model="form.data.reset_policy" style="width:100%"><el-option label="不重置" value="never" /><el-option label="每年" value="year" /><el-option label="每月" value="month" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="启用"><el-switch v-model="form.data.is_active" active-text="启用" inactive-text="停用" /></el-form-item></el-col>
          <el-col :span="24">
            <el-form-item label="客户映射">
              <div style="width:100%">
                <div style="margin-bottom:6px">
                  <el-tag v-for="(token, name) in customerMap" :key="name" closable style="margin:2px" @close="removeMapping(name)">{{ name }} → {{ token }}</el-tag>
                </div>
                <div style="display:flex;gap:6px">
                  <el-select v-model="mappingCustomer" filterable allow-create default-first-option placeholder="选择客户主数据/手输" style="flex:1">
                    <el-option v-for="name in customerOptions" :key="name" :label="name" :value="name" />
                  </el-select>
                  <el-input v-model="mappingToken" placeholder="缩写，如 ZZDT" style="width:130px" />
                  <el-button @click="addMapping">添加映射</el-button>
                </div>
                <el-input v-model="form.data.customer_map_json" type="textarea" :rows="2" style="margin-top:6px" placeholder='{"郑州地铁集团":"ZZDT"}' />
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="24"><el-form-item label="说明"><el-input v-model="form.data.description" type="textarea" :rows="2" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="form.visible = false">取消</el-button>
        <el-button type="primary" :loading="form.saving" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { DataAnalysis, Refresh } from '@element-plus/icons-vue'
import PageToolbar from '../components/PageToolbar.vue'
import { Api } from '../api'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const canManage = auth.hasPerm('settings:write')
const loading = ref(false)
const previewLoading = ref(false)
const rules = ref<any[]>([])
const customerOptions = ref<string[]>([])
const mappingCustomer = ref('')
const mappingToken = ref('')
const previewRule = ref('equipment_instance')
const preview = reactive<any>({ code: '', customer: '', year: new Date().getFullYear(), description: '' })
const customerMap = computed<Record<string, string>>(() => {
  try { return JSON.parse(form.data.customer_map_json || '{}') } catch (_error) { return {} }
})
const form = reactive<any>({ visible: false, isEdit: false, saving: false, data: defaultRule() })

function defaultRule() {
  return {
    rule_code: '', name: '', entity_type: 'equipment_instance', prefix: 'TBM', separator: '-',
    year_mode: 'year', customer_mode: 'token', sequence_width: 3, reset_policy: 'year',
    customer_map_json: '{}', is_active: true, description: '',
  }
}

async function loadAll() {
  loading.value = true
  try {
    const [data, customers]: any[] = await Promise.all([
      Api.get('/coding-rules'),
      Api.get('/coding-rules/customer-options').catch(() => ({ customers: [] })),
    ])
    rules.value = data.rules || []
    customerOptions.value = customers.customers || []
    if (!rules.value.some((rule) => rule.rule_code === previewRule.value) && rules.value.length) {
      previewRule.value = rules.value[0].rule_code
    }
    await runPreview()
  } catch (error: any) {
    ElMessage.error('加载编码规则失败：' + (error?.response?.data?.message || error.message))
  } finally { loading.value = false }
}

async function runPreview() {
  if (!previewRule.value) return
  previewLoading.value = true
  try {
    const data: any = await Api.get(`/coding-rules/${encodeURIComponent(previewRule.value)}/preview`, {
      params: { customer: preview.customer, year: preview.year },
    })
    preview.code = data.code
    preview.description = data.description || data.rule_code
  } catch (error: any) {
    preview.code = ''
    ElMessage.error('编码预览失败：' + (error?.response?.data?.message || error.message))
  } finally { previewLoading.value = false }
}

function addMapping() {
  const name = String(mappingCustomer.value || '').trim()
  const token = String(mappingToken.value || '').trim().toUpperCase()
  if (!name || !token) return ElMessage.warning('请选择客户并填写缩写')
  const map = { ...customerMap.value, [name]: token }
  form.data.customer_map_json = JSON.stringify(map)
  mappingCustomer.value = ''
  mappingToken.value = ''
}

function removeMapping(name: string) {
  const map = { ...customerMap.value }
  delete map[name]
  form.data.customer_map_json = JSON.stringify(map)
}

function openPreview(row: any) {
  previewRule.value = row.rule_code
  runPreview()
}

function openForm(row?: any) {
  form.isEdit = Boolean(row)
  form.data = row ? { ...row, customer_map_json: row.customer_map_json || '{}' } : defaultRule()
  form.visible = true
}

async function saveRule() {
  if (!form.data.rule_code || !form.data.name) return ElMessage.warning('请填写规则编码和名称')
  form.saving = true
  try {
    if (form.isEdit) await Api.put(`/coding-rules/${encodeURIComponent(form.data.rule_code)}`, form.data)
    else await Api.post('/coding-rules', form.data)
    ElMessage.success('编码规则已保存')
    form.visible = false
    await loadAll()
  } catch (error: any) {
    ElMessage.error('保存失败：' + (error?.response?.data?.message || error.message))
  } finally { form.saving = false }
}

onMounted(loadAll)
</script>

<style scoped>
.page { padding: 16px; }
.page-header { margin-bottom: 12px; }
.page-title { font-size: 20px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.page-subtitle { color: var(--el-text-color-secondary); font-size: 13px; margin-top: 4px; }
.card-header { display: flex; align-items: center; justify-content: space-between; }
.preview-alert { margin-bottom: 12px; }
.hint { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
