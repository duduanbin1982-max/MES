<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div class="page-title"><el-icon><Memo /></el-icon> 审计日志</div>
      <el-button @click="load">刷新</el-button>
    </PageToolbar>
    <el-card>
      <el-form :inline="true" size="small" style="margin-bottom: 12px">
        <el-form-item label="操作">
          <el-select v-model="filter.action" clearable filterable placeholder="全部" style="width: 240px">
            <el-option v-for="a in actionOptions" :key="a" :label="a" :value="a" />
          </el-select>
        </el-form-item>
        <el-form-item label="资源类型">
          <el-select v-model="filter.resource_type" clearable placeholder="全部" style="width: 160px">
            <el-option v-for="t in ['role', 'material', 'material_lot', 'purchase_order', 'work_order', 'user']" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filter.status" clearable placeholder="全部" style="width: 120px">
            <el-option label="success" value="success" />
            <el-option label="failed" value="failed" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="rows" stripe size="small" v-loading="loading">
        <el-table-column prop="id" label="#" width="60" />
        <el-table-column prop="created_at" label="时间" width="160" />
        <el-table-column label="操作人" width="160">
          <template #default="{ row }">
            <span>{{ row.username || '-' }}</span>
            <el-tag size="small" style="margin-left: 4px">{{ row.role || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="action" label="动作" width="220">
          <template #default="{ row }">
            <code style="font-size: 12px">{{ row.action }}</code>
          </template>
        </el-table-column>
        <el-table-column label="资源" width="180">
          <template #default="{ row }">
            <span v-if="row.resource_type">{{ row.resource_type }}#{{ row.resource_id || '-' }}</span>
            <span v-else style="color: var(--el-color-info)">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="diff_summary" label="变更摘要" min-width="240" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'success' ? 'success' : 'danger'" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="IP" width="120">
          <template #default="{ row }">
            <span style="font-family: monospace; font-size: 11px">{{ row.ip || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="详情" width="80">
          <template #default="{ row }">
            <el-button size="small" link @click="showDetail(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div style="margin-top: 12px; text-align: right">
        <el-pagination
          v-model:current-page="page.current"
          :page-size="page.size"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="load"
        />
      </div>
    </el-card>

    <!-- 详情对话框 -->
    <el-dialog v-model="dlgDetail" title="审计日志详情" width="720px">
      <pre v-if="current" style="background: var(--el-fill-color-light); padding: 12px; border-radius: 4px; font-size: 12px; max-height: 500px; overflow: auto">{{ JSON.stringify(current, null, 2) }}</pre>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import api from '../api'

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const page = reactive({ current: 1, size: 50 })
const filter = reactive<any>({ action: '', resource_type: '', status: '' })
const dlgDetail = ref(false)
const current = ref<any>(null)
const actionOptions = ref<string[]>([])

const showDetail = (row: any) => { current.value = row; dlgDetail.value = true }

const load = async () => {
  loading.value = true
  try {
    const params: any = { limit: page.size, offset: (page.current - 1) * page.size }
    if (filter.action) params.action = filter.action
    if (filter.resource_type) params.resource_type = filter.resource_type
    if (filter.status) params.status = filter.status
    const r: any = await api.get('/audit/logs', { params })
    rows.value = r.rows
    total.value = r.total
    // 收集 action 列表
    const set = new Set<string>(actionOptions.value)
    r.rows.forEach((x: any) => set.add(x.action))
    actionOptions.value = Array.from(set).sort()
  } finally { loading.value = false }
}

const search = () => { page.current = 1; load() }

onMounted(load)
</script>

<style scoped>
.page { padding: 16px }
.page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px }
.page-title { font-size: 18px; font-weight: 600 }
</style>