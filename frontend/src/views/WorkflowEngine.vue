<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title"><el-icon><Refresh /></el-icon> 工作流引擎</div>
      <div>
        <el-radio-group v-model="viewMode" size="small" style="margin-right: 12px">
          <el-radio-button value="defs">流程定义</el-radio-button>
          <el-radio-button value="instances">运行实例</el-radio-button>
        </el-radio-group>
        <el-button type="primary" @click="openStart" :disabled="viewMode!=='instances'">+ 启动工作流</el-button>
      </div>
    </div>

    <!-- 流程定义视图 -->
    <div v-if="viewMode==='defs'" v-loading="defLoading">
      <el-row :gutter="16">
        <el-col :span="8" v-for="d in definitions" :key="d.name">
          <el-card shadow="hover" style="margin-bottom: 12px">
            <template #header>
              <span style="font-weight: 600">{{ d.display_name }}</span>
              <el-tag size="small" style="margin-left: 8px">{{ d.entity_type }}</el-tag>
            </template>
            <p style="color: var(--el-color-info); font-size: 13px; margin-bottom: 8px">{{ d.description }}</p>
            <div style="margin-bottom: 8px">
              <span style="font-size: 12px; color: var(--el-color-info)">状态流转: </span>
              <el-tag v-for="(s,i) in d.states" :key="s" size="small" style="margin: 2px" :type="i===0?'':i===d.states.length-1?'success':''">{{ s }}</el-tag>
            </div>
            <div><span style="font-size: 12px; color: var(--el-color-info)">迁移数: {{ d.transitions_count }}</span></div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 运行实例视图 -->
    <div v-else v-loading="instLoading">
      <!-- 筛选 -->
      <div class="toolbar">
        <el-select v-model="filter.definition" placeholder="流程类型" clearable @change="loadInstances" style="width: 160px">
          <el-option v-for="d in definitions" :key="d.name" :label="d.display_name" :value="d.name" />
        </el-select>
        <el-select v-model="filter.status" placeholder="状态" clearable @change="loadInstances" style="width: 120px">
          <el-option label="运行中" value="active" /><el-option label="已完成" value="completed" /><el-option label="已取消" value="cancelled" />
        </el-select>
        <el-input v-model="filter.entityId" placeholder="实体ID" clearable @change="loadInstances" style="width: 120px" />
        <el-button @click="loadInstances">刷新</el-button>
      </div>

      <el-table :data="instances" stripe size="small">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column label="流程" width="120">
          <template #default="{ row }"><el-tag size="small">{{ row.definition_name }}</el-tag></template>
        </el-table-column>
        <el-table-column label="实体" width="160">
          <template #default="{ row }">{{ row.entity_type }} #{{ row.entity_id }}</template>
        </el-table-column>
        <el-table-column label="当前状态" width="120">
          <template #default="{ row }"><el-tag :type="row.status==='active'?'warning':row.status==='completed'?'success':'info'" size="small">{{ row.current_state }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="assigned_to_name" label="负责人" width="100" />
        <el-table-column prop="priority" label="优先级" width="80" align="center" />
        <el-table-column prop="created_at" label="创建时间" width="160" />
        <el-table-column label="操作" width="200" align="center" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="viewInstance(row)">详情</el-button>
            <el-button v-if="row.status==='active'" size="small" type="primary" @click="openTransit(row)">流转</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 启动工作流弹窗 -->
    <el-dialog v-model="startDlg.visible" title="启动工作流" width="500px">
      <el-form :model="startDlg.form" label-width="90px">
        <el-form-item label="流程类型" required>
          <el-select v-model="startDlg.form.definition_name" style="width: 100%">
            <el-option v-for="d in definitions" :key="d.name" :label="d.display_name" :value="d.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="实体类型" required><el-input v-model="startDlg.form.entity_type" placeholder="如: eco, work_order" /></el-form-item>
        <el-form-item label="实体ID" required><el-input v-model.number="startDlg.form.entity_id" type="number" /></el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="startDlg.form.priority" style="width: 100%">
            <el-option label="普通" :value="0" /><el-option label="紧急" :value="1" /><el-option label="特急" :value="2" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="startDlg.form.comment" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="startDlg.visible=false">取消</el-button>
        <el-button type="primary" @click="doStart" :loading="startDlg.saving">启动</el-button>
      </template>
    </el-dialog>

    <!-- 流转弹窗 -->
    <el-dialog v-model="transitDlg.visible" title="状态流转" width="450px">
      <el-form :model="transitDlg.form" label-width="80px">
        <el-form-item label="当前状态"><el-tag>{{ transitDlg.instance?.current_state }}</el-tag></el-form-item>
        <el-form-item label="操作" required>
          <el-select v-model="transitDlg.form.action" style="width: 100%">
            <el-option v-for="a in transitDlg.actions" :key="a" :label="a" :value="a" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="transitDlg.form.comment" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="transitDlg.visible=false">取消</el-button>
        <el-button type="primary" @click="doTransit" :loading="transitDlg.saving">执行</el-button>
      </template>
    </el-dialog>

    <!-- 实例详情弹窗 -->
    <el-dialog v-model="detailDlg.visible" title="工作流详情" width="600px">
      <el-descriptions v-if="detailDlg.data" :column="2" border size="small">
        <el-descriptions-item label="ID">{{ detailDlg.data.id }}</el-descriptions-item>
        <el-descriptions-item label="流程">{{ detailDlg.data.definition_name }}</el-descriptions-item>
        <el-descriptions-item label="实体">{{ detailDlg.data.entity_type }} #{{ detailDlg.data.entity_id }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="detailDlg.data.status==='active'?'warning':'success'">{{ detailDlg.data.current_state }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="负责人">{{ detailDlg.data.assigned_to_name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ detailDlg.data.created_at }}</el-descriptions-item>
      </el-descriptions>
      <div v-if="detailDlg.data?.history?.length" style="margin-top: 12px">
        <div style="font-weight: 500; margin-bottom: 8px">流转记录</div>
        <el-timeline>
          <el-timeline-item v-for="h in detailDlg.data.history" :key="h.id" :timestamp="h.created_at" placement="top">
            {{ h.from_state }} → {{ h.to_state }} ({{ h.action }}) <span v-if="h.comment" style="color:var(--el-color-info)">— {{ h.comment }}</span>
          </el-timeline-item>
        </el-timeline>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { Api } from '../api'
import { ElMessage } from 'element-plus'

const viewMode = ref('defs')
const definitions = ref([])
const defLoading = ref(false)
const instances = ref([])
const instLoading = ref(false)
const filter = reactive({ definition: '', status: '', entityId: '' })

const startDlg = reactive({ visible: false, saving: false, form: {} })
const transitDlg = reactive({ visible: false, saving: false, instance: null, form: {}, actions: [] })
const detailDlg = reactive({ visible: false, data: null })

const loadDefs = async () => {
  defLoading.value = true
  try { definitions.value = await Api.get('/workflow/definitions') }
  catch(_) { definitions.value = [] }
  finally { defLoading.value = false }
}

const loadInstances = async () => {
  instLoading.value = true
  try {
    if (filter.entityId && filter.definition) {
      instances.value = await Api.get('/workflow/entity/' + filter.definition + '/' + filter.entityId)
      instances.value = Array.isArray(instances.value) ? instances.value : [instances.value]
    } else {
      // best-effort: get all active
      instances.value = []
    }
  } catch(_) { instances.value = [] }
  finally { instLoading.value = false }
}

const openStart = () => {
  startDlg.form = { definition_name: '', entity_type: '', entity_id: null, priority: 0, comment: '' }
  startDlg.visible = true
}

const doStart = async () => {
  startDlg.saving = true
  try {
    await Api.post('/workflow/start', startDlg.form)
    ElMessage.success('工作流已启动')
    startDlg.visible = false
    loadInstances()
  } catch(e) { ElMessage.error('启动失败') }
  finally { startDlg.saving = false }
}

const openTransit = async (row) => {
  transitDlg.instance = row
  transitDlg.form = { action: '', comment: '' }
  try {
    const inst = await Api.get('/workflow/' + row.id)
    transitDlg.actions = inst.available_actions || []
  } catch(_) { transitDlg.actions = [] }
  transitDlg.visible = true
}

const doTransit = async () => {
  transitDlg.saving = true
  try {
    await Api.post('/workflow/' + transitDlg.instance.id + '/transit', transitDlg.form)
    ElMessage.success('流转成功')
    transitDlg.visible = false
    loadInstances()
  } catch(e) { ElMessage.error('流转失败') }
  finally { transitDlg.saving = false }
}

const viewInstance = async (row) => {
  try {
    detailDlg.data = await Api.get('/workflow/' + row.id)
    detailDlg.visible = true
  } catch(e) { ElMessage.error('获取详情失败') }
}

onMounted(loadDefs)
</script>

<style scoped>
.page{padding:16px 24px}
.page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.page-title{font-size:20px;font-weight:600}
.toolbar{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
</style>
