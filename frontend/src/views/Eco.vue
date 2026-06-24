<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">🔄 设计变更 (ECO)</div>
      <el-button type="primary" @click="showCreate = true">+ 新建设计变更</el-button>
    </div>
    <el-card>
      <el-form :inline="true" :model="filters">
        <el-form-item label="实例">
          <el-select v-model="filters.project_id" clearable placeholder="全部" style="width: 240px" @change="load">
            <el-option v-for="i in instances" :key="i.id" :label="i.instance_code" :value="i.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" clearable placeholder="全部" style="width: 140px" @change="load">
            <el-option v-for="s in statuses" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>
    <el-card style="margin-top: 12px">
      <el-table :data="rows" stripe v-loading="loading" size="small">
        <el-table-column prop="eco_no" label="变更号" width="140" />
        <el-table-column prop="instance_code" label="实例" width="140" />
        <el-table-column prop="title" label="标题" min-width="200" />
        <el-table-column prop="reason" label="原因" min-width="200" show-overflow-tooltip />
        <el-table-column prop="affected_scope" label="影响范围" min-width="200" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="ecoTagType(row.status)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="effective_date" label="生效日" width="120" />
        <el-table-column prop="closed_date" label="关闭日" width="120" />
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button v-if="row.status === 'open'" size="small" type="primary" @click="setStatus(row, 'approved')">批准</el-button>
            <el-button v-if="row.status === 'approved'" size="small" type="success" @click="setStatus(row, 'closed')">关闭</el-button>
            <el-button v-if="row.status === 'open'" size="small" type="danger" @click="setStatus(row, 'rejected')">拒绝</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showCreate" title="新建设计变更" width="500px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="实例" required>
          <el-select v-model="form.equipment_instance_id" placeholder="选实例" style="width: 100%">
            <el-option v-for="i in instances" :key="i.id" :label="i.instance_code" :value="i.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="变更号" required>
          <el-input v-model="form.eco_no" placeholder="如 ECO-2026-001" />
        </el-form-item>
        <el-form-item label="标题" required>
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="form.reason" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="影响范围">
          <el-input v-model="form.affected_scope" type="textarea" :rows="2" placeholder="哪些子系统/工单/物料受影响" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" @click="submit" :loading="submitting">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const filters = reactive({ project_id: undefined as any, status: '' })
const rows = ref<any[]>([])
const instances = ref<any[]>([])
const loading = ref(false)
const showCreate = ref(false)
const submitting = ref(false)
const form = reactive({
  equipment_instance_id: undefined as any, eco_no: '', title: '', reason: '', affected_scope: ''
})
const statuses = [
  { value: 'open', label: '待审批' },
  { value: 'approved', label: '已批准' },
  { value: 'closed', label: '已关闭' },
  { value: 'rejected', label: '已拒绝' }
]
const ecoTagType = (s: string) => ({ open: 'warning', approved: 'primary', closed: 'success', rejected: 'danger' }[s] || 'info')

const load = async () => {
  loading.value = true
  try {
    if (instances.value.length === 0) instances.value = await api.get('/equipment_instances')
    if (filters.project_id) {
      rows.value = await api.get(`/equipment_instances/${filters.project_id}/eco`)
      if (filters.status) rows.value = rows.value.filter((r: any) => r.status === filters.status)
    } else {
      // 全部 ECO
      const all: any[] = []
      for (const i of instances.value) {
        const eco = await api.get(`/equipment_instances/${i.id}/eco`)
        all.push(...eco.map((e: any) => ({ ...e, instance_code: i.instance_code })))
      }
      rows.value = filters.status ? all.filter(r => r.status === filters.status) : all
    }
    rows.value.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  } finally { loading.value = false }
}

const setStatus = async (row: any, status: string) => {
  const update: any = { status }
  if (status === 'closed') update.closed_date = new Date().toISOString().slice(0, 10)
  if (status === 'approved') update.effective_date = new Date().toISOString().slice(0, 10)
  await api.put(`/instance_eco/${row.id}`, update) // ECO 端点
  
  ElMessage.success('已更新')
  load()
}

const submit = async () => {
  if (!form.equipment_instance_id || !form.eco_no || !form.title) { ElMessage.warning('请填完整'); return }
  submitting.value = true
  try {
    await api.post(`/equipment_instances/${form.equipment_instance_id}/eco`, form)
    ElMessage.success('已记录')
    showCreate.value = false
    Object.assign(form, { equipment_instance_id: undefined, eco_no: '', title: '', reason: '', affected_scope: '' })
    await load()
  } catch (e: any) { ElMessage.error('失败') }
  finally { submitting.value = false }
}

onMounted(load)
</script>
