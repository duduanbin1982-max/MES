<template>
  <div class="scan-page">
    <div class="scan-header">
      <h2 style="margin: 0 0 12px 0">📱 PDA 扫码报工</h2>
      <el-input
        v-model="code"
        size="large"
        placeholder="工单号 WO-xxx 或 工艺节点 PN-xxx"
        @keyup.enter="lookup"
        clearable
      >
        <template #append>
          <el-button type="primary" size="large" @click="lookup" :loading="loading">
            <el-icon><Search /></el-icon>查询
          </el-button>
        </template>
      </el-input>
    </div>

    <!-- 类型提示 -->
    <div v-if="target" class="type-bar">
      <el-tag :type="target.type === 'work_order' ? 'primary' : 'success'" size="large">
        {{ target.type === 'work_order' ? '📋 工单' : '🔧 工艺节点' }}
      </el-tag>
      <span style="margin-left: 12px; color: #606266">{{ target.data?.wo_code || 'PN-' + target.data?.id }}</span>
    </div>

    <!-- 工单详情 -->
    <div v-if="target && target.type === 'work_order'" class="wo-card">
      <el-card shadow="never">
        <div class="wo-title">
          <div>
            <div style="font-size: 18px; font-weight: 600">{{ target.data.wo_code }}</div>
            <div style="color: #606266; font-size: 14px; margin-top: 4px">{{ target.data.title }}</div>
          </div>
          <el-tag :type="woTagType(target.data.status)" size="large">{{ target.data.status }}</el-tag>
        </div>

        <el-descriptions :column="1" border style="margin-top: 12px">
          <el-descriptions-item label="所属实例">{{ target.data.instance_code }} · {{ target.data.instance_name || '' }}</el-descriptions-item>
          <el-descriptions-item label="子系统">{{ target.data.subsystem_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="工位">{{ target.data.workstation_name || '-' }}</el-descriptions-item>
        </el-descriptions>

        <div class="action-grid">
          <el-button type="primary" size="large" :disabled="target.data.status === 'in_progress' || target.data.status === 'completed'" @click="doAction('start')">▶ 开始</el-button>
          <el-button type="warning" size="large" :disabled="target.data.status !== 'in_progress'" @click="doAction('pause')">⏸ 暂停</el-button>
          <el-button type="success" size="large" :disabled="target.data.status === 'completed'" @click="doAction('complete')">✓ 完成</el-button>
          <el-button type="danger" size="large" @click="showIssue = true">⚠ 异常</el-button>
        </div>
      </el-card>
    </div>

    <!-- 工艺节点详情 -->
    <div v-if="target && target.type === 'process_node'" class="wo-card">
      <el-card shadow="never">
        <div class="wo-title">
          <div>
            <div style="font-size: 18px; font-weight: 600">PN-{{ target.data.id }} · {{ target.data.operation_name }}</div>
            <div style="color: #606266; font-size: 14px; margin-top: 4px">{{ target.data.material_name || '(总装/上级工序)' }}</div>
          </div>
          <el-tag :type="pnTagType(target.data.status)" size="large">{{ target.data.status }}</el-tag>
        </div>

        <el-descriptions :column="1" border style="margin-top: 12px">
          <el-descriptions-item label="所属项目">{{ target.data.instance_code }}</el-descriptions-item>
          <el-descriptions-item label="工序类型">{{ target.data.operation_type }}</el-descriptions-item>
          <el-descriptions-item label="估时">{{ target.data.estimated_hours }} 小时</el-descriptions-item>
          <el-descriptions-item label="前置节点">{{ target.data.predecessors?.length || 0 }} 个</el-descriptions-item>
          <el-descriptions-item label="后继节点">{{ target.data.successors?.length || 0 }} 个</el-descriptions-item>
        </el-descriptions>

        <div class="action-grid">
          <el-button type="primary" size="large" :disabled="target.data.status === 'in_progress' || target.data.status === 'completed'" @click="doAction('start')">▶ 开始</el-button>
          <el-button type="success" size="large" :disabled="target.data.status === 'completed'" @click="doAction('complete')">✓ 完成</el-button>
          <el-button type="danger" size="large" @click="doAction('block')">⚠ 卡住</el-button>
          <el-button type="warning" size="large" @click="showIssue = true">📝 备注</el-button>
        </div>
      </el-card>
    </div>

    <el-empty v-else-if="!loading && searched" description="未找到该码" :image-size="80" />

    <el-dialog v-model="showIssue" :title="target?.type === 'work_order' ? '⚠ 上报异常' : '📝 添加备注'" width="90%" max-width="500px">
      <el-form :model="issueForm" label-width="80px">
        <el-form-item :label="target?.type === 'work_order' ? '问题描述' : '备注内容'" required>
          <el-input v-model="issueForm.notes" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="工时">
          <el-input-number v-model="issueForm.hours_worked" :min="0" :step="0.5" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showIssue = false">取消</el-button>
        <el-button :type="target?.type === 'work_order' ? 'danger' : 'primary'" @click="submitNote">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const code = ref('')
const target = ref<any>(null)
const loading = ref(false)
const searched = ref(false)
const showIssue = ref(false)
const issueForm = reactive({ notes: '', hours_worked: 0 })

const woTagType = (s: string) => ({ pending: 'info', in_progress: 'primary', paused: 'warning', completed: 'success', issue: 'danger', rework: 'danger' }[s] || 'info')
const pnTagType = (s: string) => ({ pending: 'info', ready: 'primary', in_progress: 'success', completed: 'success', blocked: 'danger', paused: 'warning' }[s] || 'info')

const lookup = async () => {
  if (!code.value.trim()) { ElMessage.warning('请输入码'); return }
  loading.value = true
  searched.value = true
  try {
    const res: any = await api.get('/scan/lookup?code=' + encodeURIComponent(code.value.trim()))
    if (res.error) {
      target.value = null
      ElMessage.error(res.error)
    } else {
      target.value = res
      // 工艺节点额外获取 detail (含 predecessors/successors)
      if (res.type === 'process_node') {
        const detail: any = await api.get('/process_nodes/' + res.data.id)
        target.value.data = Object.assign({}, res.data, { predecessors: detail.predecessors, successors: detail.successors })
      }
    }
  } catch (e: any) {
    target.value = null
    ElMessage.error(e.response?.data?.error || '查询失败')
  } finally {
    loading.value = false
  }
}

const doAction = async (action: string) => {
  if (!target.value) return
  if (action === 'complete') {
    try { await ElMessageBox.confirm('确认' + (target.value.type === 'work_order' ? '工单' : '节点') + '已完成？', '完成确认', { type: 'success' }) } catch { return }
  }
  try {
    const payload: any = { code: code.value.trim(), action, operator_id: 4 }
    const res: any = await api.post('/scan/execute', payload)
    ElMessage.success(res.message)
    await lookup()  // 刷新
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '操作失败')
  }
}

const submitNote = async () => {
  if (!issueForm.notes) { ElMessage.warning('请填写内容'); return }
  try {
    const action = target.value?.type === 'work_order' ? 'note' : 'note'
    await api.post('/scan/execute', { code: code.value.trim(), action, operator_id: 4, notes: issueForm.notes, hours_worked: issueForm.hours_worked })
    ElMessage.success('已记录')
    showIssue.value = false
    issueForm.notes = ''; issueForm.hours_worked = 0
    await lookup()
  } catch (e: any) { ElMessage.error('失败') }
}
</script>

<style scoped>
.scan-page { padding: 12px; max-width: 600px; margin: 0 auto; }
.scan-header { background: #fff; padding: 16px; border-radius: 8px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
.type-bar { background: #fff; padding: 12px 16px; border-radius: 8px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
.wo-card { margin-bottom: 12px; }
.wo-title { display: flex; justify-content: space-between; align-items: flex-start; }
.action-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
.action-grid .el-button { height: 60px; font-size: 18px; font-weight: 500; }
@media (max-width: 480px) {
  .scan-page { padding: 8px; }
  .action-grid .el-button { height: 50px; font-size: 16px; }
}
</style>
