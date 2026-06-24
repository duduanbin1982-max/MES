<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">📅 项目排程 (S1-S10 里程碑)</div>
      <el-button @click="load">刷新</el-button>
    </div>
    <el-card>
      <el-form :inline="true" :model="filters">
        <el-form-item label="实例">
          <el-select v-model="selectedInstance" placeholder="选实例" style="width: 280px" @change="load">
            <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>
    <el-card v-if="selectedInstance" style="margin-top: 12px">
      <div v-if="milestones.length">
        <!-- 简单甘特: 表格展示 -->
        <el-table :data="milestones" stripe size="small">
          <el-table-column prop="phase_code" label="阶段" width="80" />
          <el-table-column prop="phase_name" label="名称" width="120" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="msTagType(row.status)" size="small">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="计划时间" width="240">
            <template #default="{ row }">{{ row.planned_start || '-' }} → {{ row.planned_end || '-' }}</template>
          </el-table-column>
          <el-table-column label="实际时间" width="240">
            <template #default="{ row }">{{ row.actual_start || '-' }} → {{ row.actual_end || '-' }}</template>
          </el-table-column>
          <el-table-column label="进度" min-width="300">
            <template #default="{ row }">
              <el-progress :percentage="msProgress(row)" :status="row.status === 'completed' ? 'success' : (row.status === 'delayed' ? 'exception' : '')" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160">
            <template #default="{ row }">
              <el-button v-if="row.status !== 'completed'" size="small" type="success" @click="markComplete(row)">✓ 完成</el-button>
              <el-button v-if="row.status === 'pending'" size="small" type="primary" @click="markActive(row)">开始</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <el-empty v-else description="该实例没有里程碑" :image-size="60" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const instances = ref<any[]>([])
const selectedInstance = ref<any>(undefined)
const milestones = ref<any[]>([])

const msTagType = (s: string) => ({ pending: 'info', active: 'primary', completed: 'success', delayed: 'danger' }[s] || 'info')
const msProgress = (m: any) => {
  if (m.status === 'completed') return 100
  if (m.status === 'active') return 50
  if (m.status === 'delayed') return 25
  return 0
}

const load = async () => {
  if (instances.value.length === 0) instances.value = await api.get('/equipment_instances')
  if (selectedInstance.value) {
    milestones.value = await api.get(`/equipment_instances/${selectedInstance.value}/milestones`)
  }
}

const markActive = async (m: any) => {
  await api.put(`/milestones/${m.id}`, { status: 'active' })
  ElMessage.success(`${m.phase_code} 已开始`)
  load()
}

const markComplete = async (m: any) => {
  await api.put(`/milestones/${m.id}`, { status: 'completed', actual_end: new Date().toISOString().slice(0, 10) })
  ElMessage.success(`${m.phase_code} 已完成`)
  load()
}

onMounted(load)
</script>
