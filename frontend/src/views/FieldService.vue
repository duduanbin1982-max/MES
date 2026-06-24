<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">🔧 现场服务</div>
      <el-button type="primary" @click="showCreate = true">+ 新建服务工单</el-button>
    </div>
    <el-card>
      <el-table :data="rows" stripe v-loading="loading" size="small" @row-click="showDetail" style="cursor: pointer">
        <el-table-column prop="instance_code" label="实例" width="140" />
        <el-table-column prop="instance_name" label="名称" min-width="180" />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.service_type === 'warranty' ? 'warning' : 'primary'">{{ serviceLabel(row.service_type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="180" />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="优先级" width="80">
          <template #default="{ row }">
            <el-tag :type="row.priority === 'urgent' ? 'danger' : (row.priority === 'normal' ? 'info' : 'success')" size="small">{{ row.priority }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="fsTagType(row.status)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reported_date" label="报告日期" width="180" />
        <el-table-column prop="resolved_date" label="解决日期" width="120" />
      </el-table>
    </el-card>

    <!-- 详情对话框 -->
    <el-dialog v-model="showDetailDlg" :title="detail?.title" width="600px" v-if="detail">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="服务工单 ID">{{ detail.id }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="fsTagType(detail.status)" size="small">{{ detail.status }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="实例">{{ detail.instance_code }} · {{ detail.instance_name }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{ serviceLabel(detail.service_type) }}</el-descriptions-item>
        <el-descriptions-item label="优先级">{{ detail.priority }}</el-descriptions-item>
        <el-descriptions-item label="报告人 ID">{{ detail.assigned_to || '-' }}</el-descriptions-item>
        <el-descriptions-item label="报告日期" :span="2">{{ detail.reported_date }}</el-descriptions-item>
        <el-descriptions-item label="解决日期" :span="2">{{ detail.resolved_date || '未解决' }}</el-descriptions-item>
        <el-descriptions-item label="描述" :span="2">{{ detail.description || '-' }}</el-descriptions-item>
        <el-descriptions-item label="解决说明" :span="2">{{ detail.resolution_notes || '-' }}</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button v-if="detail.status === 'open'" @click="updateStatus(detail, 'assigned')">指派</el-button>
        <el-button v-if="detail.status === 'assigned'" @click="updateStatus(detail, 'in_progress')">开始处理</el-button>
        <el-button v-if="detail.status === 'in_progress'" type="success" @click="updateStatus(detail, 'resolved')">已解决</el-button>
        <el-button @click="showDetailDlg = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showCreate" title="新建现场服务工单" width="500px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="装备实例" required>
          <el-select v-model="form.equipment_instance_id" placeholder="选实例" style="width: 100%">
            <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="服务类型" required>
          <el-select v-model="form.service_type" style="width: 100%">
            <el-option label="现场组装" value="assembly" />
            <el-option label="现场调试" value="commissioning" />
            <el-option label="质保维修" value="warranty" />
            <el-option label="故障响应" value="repair" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题" required>
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="form.priority" style="width: 100%">
            <el-option label="低" value="low" />
            <el-option label="正常" value="normal" />
            <el-option label="紧急" value="urgent" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submit">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const rows = ref<any[]>([])
const instances = ref<any[]>([])
const loading = ref(false)
const serviceLabel = (s: string) => ({ assembly: '现场组装', commissioning: '现场调试', warranty: '质保维修', repair: '故障响应' }[s] || s)
const fsTagType = (s: string) => ({ open: 'danger', assigned: 'warning', in_progress: 'primary', resolved: 'success', closed: 'info' }[s] || 'info')

const detail = ref<any>(null)
const showDetailDlg = ref(false)
const showDetail = (row: any) => { detail.value = row; showDetailDlg.value = true }

const updateStatus = async (row: any, status: string) => {
  try {
    await api.put(`/field_service/${row.id}`, { status, resolution_notes: row.resolution_notes || '已处理' })
    ElMessage.success('状态已更新: ' + status)
    showDetailDlg.value = false
    load()
  } catch (e: any) {
    ElMessage.error('更新失败: ' + (e.response?.data?.error || e.message))
  }
}

const showCreate = ref(false)
const creating = ref(false)
const form = reactive({
  equipment_instance_id: undefined as any, service_type: 'commissioning',
  title: '', description: '', priority: 'normal'
})

const load = async () => {
  loading.value = true
  try {
    rows.value = await api.get('/field_service')
    if (instances.value.length === 0) instances.value = await api.get('/equipment_instances')
  } finally { loading.value = false }
}

const submit = async () => {
  if (!form.equipment_instance_id || !form.title) { ElMessage.warning('请填写必填项'); return }
  creating.value = true
  try {
    await api.post('/field_service', form)
    ElMessage.success('已创建')
    showCreate.value = false
    Object.assign(form, { equipment_instance_id: undefined, service_type: 'commissioning', title: '', description: '', priority: 'normal' })
    load()
  } catch (e: any) { ElMessage.error('失败') }
  finally { creating.value = false }
}

onMounted(load)
</script>
