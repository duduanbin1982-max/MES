<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div class="page-title"><el-icon><Setting /></el-icon> 系统设置</div>
      <div>
        <el-button @click="load" :loading="loading">刷新</el-button>
        <el-button v-if="canTestFeishu" @click="showTestFeishu = true" type="primary">测试飞书</el-button>
      </div>
    </PageToolbar>

    <el-tabs v-model="activeTab" class="settings-tabs">
      <el-tab-pane label="参数配置" name="settings">
        <el-row :gutter="12" style="margin-bottom: 12px" v-loading="loading">
          <el-col :xs="24" :sm="12" :lg="6"><div class="stat-card"><div class="stat-label">总设置</div><div class="stat-value">{{ stats.total }}</div></div></el-col>
          <el-col :xs="24" :sm="12" :lg="6"><div class="stat-card"><div class="stat-label">已设置</div><div class="stat-value" style="color: var(--el-color-success)">{{ stats.set }}</div></div></el-col>
          <el-col :xs="24" :sm="12" :lg="6"><div class="stat-card"><div class="stat-label">未设置</div><div class="stat-value" style="color: var(--el-color-warning)">{{ stats.unset }}</div></div></el-col>
          <el-col :xs="24" :sm="12" :lg="6"><div class="stat-card"><div class="stat-label">敏感项</div><div class="stat-value" style="color: var(--el-color-info)">{{ stats.secret }}</div></div></el-col>
        </el-row>

        <el-card>
          <template #header>
            <div class="settings-filter">
              <el-select v-model="category" placeholder="全部分类" clearable style="width: 160px" @change="load">
                <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
              </el-select>
              <span>已接入参数 5s 内生效；标记“未接入”的参数仅存储，不改变业务</span>
            </div>
          </template>
          <el-table :data="filtered" stripe size="small" empty-text="加载中">
            <el-table-column prop="key" label="Key" width="220" />
            <el-table-column prop="category" label="分类" width="120">
              <template #default="{ row }">
                <el-tag size="small" :type="categoryColor(row.category)">{{ row.category }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="value_type" label="类型" width="80" />
            <el-table-column label="值" min-width="200">
              <template #default="{ row }">
                <span v-if="row.is_secret" class="secret-value">**** (敏感) — {{ row.is_set ? '已设置' : '未设置' }}</span>
                <span v-else class="mono">{{ formatValue(row) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="说明" min-width="190" show-overflow-tooltip />
            <el-table-column label="生效范围" width="145">
              <template #default="{ row }">
                <el-tag v-if="row.implemented" type="success" size="small">{{ row.consumer || '已接入' }}</el-tag>
                <el-tooltip v-else :content="row.note || '业务尚未读取该参数'" placement="top">
                  <el-tag type="warning" size="small">未接入</el-tag>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column prop="updated_at" label="更新时间" width="160" />
            <el-table-column v-if="canManage" label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" @click="edit(row)">编辑</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="运维诊断" name="diagnostics">
        <SystemDiagnostics v-if="activeTab === 'diagnostics'" />
      </el-tab-pane>
    </el-tabs>

    <!-- 编辑对话框 -->
    <el-dialog v-model="showEdit" :title="editing.key" width="560px">
      <el-alert v-if="editing.implemented === false" type="warning" :closable="false" show-icon class="edit-alert"
        title="该参数当前未被业务读取，保存后只会存储，不会改变现有业务结果。" :description="editing.note" />
      <el-form label-width="110px">
        <el-form-item label="参数说明">
          <div class="edit-desc">{{ editing.description || '—' }}</div>
        </el-form-item>
        <el-form-item :label="editing.value_type === 'boolean' ? '值（开关）' : editing.value_type === 'number' ? '值（数值）' : editing.is_secret ? '值（敏感）' : '值'">
          <el-switch v-if="editing.value_type === 'boolean'" v-model="editing.value" active-text="启用" inactive-text="停用" />
          <el-input-number v-else-if="editing.value_type === 'number'" v-model="editing.value" :min="0" :max="100000000" style="width: 100%" />
          <el-input v-else-if="editing.value_type === 'json'" v-model="editing.value" type="textarea" :rows="6" placeholder="请输入合法 JSON" />
          <el-input v-else v-model="editing.value" :type="editing.is_secret ? 'password' : 'text'" :show-password="editing.is_secret"
            :placeholder="editing.is_secret ? '敏感值不回显；留空表示保持不变' : (editing.description || '')" />
        </el-form-item>
        <el-form-item v-if="editing.is_secret" label="清空敏感值">
          <el-checkbox v-model="editing.clear_secret">明确清空该敏感参数</el-checkbox>
        </el-form-item>
        <el-form-item label="生效范围">
          <el-tag v-if="editing.implemented" type="success" size="small">{{ editing.consumer || '已接入' }}</el-tag>
          <el-tag v-else type="warning" size="small">未接入（仅存储）</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" @click="save" :loading="saving">保存</el-button>
      </template>
    </el-dialog>

    <!-- 飞书测试对话框 -->
    <el-dialog v-model="showTestFeishu" title="测试飞书通知" width="500px">
      <el-form label-width="80px">
        <el-form-item label="标题">
          <el-input v-model="testFeishu.title" placeholder="测试标题" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="testFeishu.content" type="textarea" :rows="4" placeholder="测试内容" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showTestFeishu = false">取消</el-button>
        <el-button type="primary" @click="sendTestFeishu" :loading="sending">发送</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import { ElMessage } from 'element-plus'
import SystemDiagnostics from './settings/SystemDiagnostics.vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const canManage = auth.hasPerm('settings:write')
const canTestFeishu = auth.hasPerm('feishu:notify')
const route = useRoute()
const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const sending = ref(false)
const items = ref<any[]>([])
const category = ref<string>('')
const showEdit = ref(false)
const showTestFeishu = ref(false)
const editing = ref<any>({ key: '', value: '', value_type: 'string', description: '', is_secret: false })
const testFeishu = ref({ title: 'MES 测试消息', content: '这是一条来自 Settings.vue 的测试消息' })
const tabNames = new Set(['settings', 'diagnostics'])
const activeTab = ref(tabNames.has(String(route.query.tab || '')) ? String(route.query.tab) : 'settings')

const categories = computed(() => [...new Set(items.value.map((i: any) => i.category).filter(Boolean))])
const filtered = computed(() => category.value ? items.value.filter((i: any) => i.category === category.value) : items.value)
const stats = computed(() => {
  const total = items.value.length
  const set = items.value.filter((i: any) => i.is_set).length
  return { total, set, unset: total - set, secret: items.value.filter((i: any) => i.is_secret).length }
})

const categoryColor = (c: string) => ({ notification: 'success', system: 'info', security: 'danger' }[c] || '')

watch(() => route.query.tab, (value) => {
  const next = tabNames.has(String(value || '')) ? String(value) : 'settings'
  if (next !== activeTab.value) activeTab.value = next
})

watch(activeTab, (value) => {
  if (route.query.tab !== value) router.replace({ query: { ...route.query, tab: value } })
})

const load = async () => {
  loading.value = true
  try {
    items.value = await api.settings.getAll()
  } catch (error: any) {
    ElMessage.error('加载参数失败：' + (error?.response?.data?.error || error.message))
  } finally { loading.value = false }
}

function formatValue(row: any) {
  if (row.value === null || row.value === undefined) return '(空)'
  if (typeof row.value === 'object') return JSON.stringify(row.value)
  return String(row.value)
}

const edit = (row: any) => {
  let value: any
  if (row.is_secret) value = ''
  else if (row.value_type === 'boolean') value = row.value === true || row.value === '1'
  else if (row.value_type === 'number') value = Number(row.value ?? 0)
  else if (row.value_type === 'json') value = row.value == null ? '' : JSON.stringify(row.value)
  else value = row.value == null ? '' : String(row.value)
  editing.value = { ...row, value, clear_secret: false }
  showEdit.value = true
}

const save = async () => {
  saving.value = true
  try {
    let v: any = editing.value.value
    if (editing.value.is_secret && !editing.value.clear_secret && (v === '' || v === null || v === undefined)) {
      v = undefined
    } else if (editing.value.value_type === 'number') {
      v = Number(v)
    } else if (editing.value.value_type === 'boolean') {
      v = Boolean(v)
    }
    const r = await api.settings.set(editing.value.key, v)
    if (r.ok) {
      ElMessage.success(r.kept ? '未修改敏感值' : '已保存')
      showEdit.value = false
      load()
    } else ElMessage.error(r.error || '保存失败')
  } catch (error: any) {
    ElMessage.error('保存失败：' + (error?.response?.data?.error || error.message))
  } finally { saving.value = false }
}

const sendTestFeishu = async () => {
  sending.value = true
  try {
    const r = await api.settings.testFeishu(testFeishu.value.title, testFeishu.value.content)
    if (r.ok) ElMessage.success('已发送')
    else ElMessage.warning('发送失败：' + (r.error || '请检查 webhook 配置'))
  } catch (error: any) {
    ElMessage.error('发送失败：' + (error?.response?.data?.error || error.message))
  } finally { sending.value = false }
}

onMounted(load)
</script>

<style scoped>
.settings-tabs {
  min-height: 360px;
}

.settings-filter {
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-filter span {
  flex: 1;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.stat-card {
  min-height: 96px;
  padding: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 14px;
  text-align: center;
  background: linear-gradient(180deg, var(--color-surface-raised), var(--el-bg-color-overlay));
  box-shadow: var(--shadow-sm);
}

.stat-label {
  margin-bottom: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.stat-value {
  color: var(--el-text-color-primary);
  font-family: "Fira Code", "Cascadia Code", monospace;
  font-size: 24px;
  font-weight: 700;
}

.secret-value {
  color: var(--el-color-info);
  font-style: italic;
}
.edit-alert { margin-bottom: 12px; }
.edit-desc { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.4; }
</style>
