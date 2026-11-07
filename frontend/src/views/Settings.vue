<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div class="page-title"><el-icon><Setting /></el-icon> 系统设置</div>
      <div>
        <el-button @click="load" :loading="loading">刷新</el-button>
        <el-button @click="showTestFeishu = true" type="primary">测试飞书</el-button>
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
              <span>修改后即时生效（5s 缓存）</span>
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
                <span v-else class="mono">{{ row.value === null ? '(空)' : row.value }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="说明" min-width="200" show-overflow-tooltip />
            <el-table-column prop="updated_at" label="更新时间" width="160" />
            <el-table-column label="操作" width="120" fixed="right">
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
    <el-dialog v-model="showEdit" :title="editing.key" width="500px">
      <el-form label-width="100px">
        <el-form-item :label="editing.value_type">
          <el-input v-model="editing.value" :type="editing.value_type === 'number' ? 'number' : 'text'" :placeholder="editing.description" />
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
  } finally { loading.value = false }
}

const edit = (row: any) => {
  editing.value = { ...row, value: row.value === null ? '' : String(row.value) }
  showEdit.value = true
}

const save = async () => {
  saving.value = true
  try {
    let v: any = editing.value.value
    if (editing.value.value_type === 'number') v = Number(v) || 0
    else if (editing.value.value_type === 'boolean') v = v === 'true' || v === '1' || v === true
    const r = await api.settings.set(editing.value.key, v)
    if (r.ok) { ElMessage.success('已保存'); showEdit.value = false; load() }
    else ElMessage.error(r.error || '保存失败')
  } finally { saving.value = false }
}

const sendTestFeishu = async () => {
  sending.value = true
  try {
    const r = await api.settings.testFeishu(testFeishu.value.title, testFeishu.value.content)
    if (r.ok) ElMessage.success('已发送')
    else ElMessage.warning('发送失败：' + (r.error || '请检查 webhook 配置'))
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
</style>
