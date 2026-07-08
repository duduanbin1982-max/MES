<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">🌐 数字孪生</div>
      <div style="display:flex;gap:8px">
        <el-button type="primary" @click="showAddModel=true">+ 注册模型</el-button>
        <el-button @click="refresh" :loading="loading">刷新</el-button>
      </div>
    </div>

    <!-- Dashboard -->
    <el-row :gutter="12" style="margin-bottom:12px">
      <el-col :span="6"><div class="stat-card"><div class="stat-label">3D模型</div><div class="stat-value" style="color:#409eff">{{ dash.models||0 }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">部件数</div><div class="stat-value">{{ dash.parts||0 }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">装配进度</div><div class="stat-value" style="color:#67c23a">{{ dash.assembly?.pct||0 }}%</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">数据覆盖</div><div class="stat-value">{{ dash.overlay_data_points||0 }}</div></div></el-col>
    </el-row>

    <!-- Models List -->
    <el-card style="margin-bottom:12px">
      <template #header><span style="font-weight:600">📦 3D 模型注册</span></template>
      <el-table :data="models" stripe size="small" @row-click="selectModel" highlight-current-row empty-text="暂无模型">
        <el-table-column prop="model_code" label="编码" width="160" />
        <el-table-column prop="model_name" label="名称" min-width="200" />
        <el-table-column prop="file_format" label="格式" width="80" />
        <el-table-column prop="polygon_count" label="面数" width="100">
          <template #default="{row}">{{ row.polygon_count ? (row.polygon_count/1000).toFixed(0)+'K' : '-' }}</template>
        </el-table-column>
        <el-table-column prop="version" label="版本" width="60" />
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'" size="small">{{row.status}}</el-tag></template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Model Detail -->
    <el-card v-if="currentModel" style="margin-bottom:12px">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">🔍 {{ currentModel.model_name }}</span>
          <div style="display:flex;gap:4px">
            <el-button size="small" @click="showAddPart=true">+ 部件</el-button>
            <el-button size="small" type="success" @click="loadScene">加载场景</el-button>
          </div>
        </div>
      </template>

      <el-row :gutter="12">
        <!-- Parts -->
        <el-col :span="12">
          <div style="font-weight:600;margin-bottom:4px">部件清单</div>
          <el-table :data="currentParts" size="small" max-height="300" empty-text="暂无部件">
            <el-table-column prop="part_name" label="名称" width="120" />
            <el-table-column prop="mesh_name" label="Mesh" width="120" />
            <el-table-column label="位置 (x,y,z)" width="140">
              <template #default="{row}">{{ row.position_x }},{{ row.position_y }},{{ row.position_z }}</template>
            </el-table-column>
            <el-table-column prop="assembly_step" label="工序" width="60" />
            <el-table-column label="色" width="60">
              <template #default="{row}"><div :style="{width:'20px',height:'20px',background:row.color_hex,borderRadius:'4px'}" /></template>
            </el-table-column>
          </el-table>
        </el-col>

        <!-- Assembly + Overlay -->
        <el-col :span="12">
          <div style="font-weight:600;margin-bottom:4px">装配状态</div>
          <el-table :data="currentAsm" size="small" max-height="300" empty-text="暂无">
            <el-table-column prop="part_name" label="部件" width="100" />
            <el-table-column label="状态" width="80">
              <template #default="{row}"><el-tag :type="row.status==='completed'?'success':row.status==='started'?'warning':'info'" size="small">{{row.status}}</el-tag></template>
            </el-table-column>
            <el-table-column prop="progress_pct" label="进度" width="70"><template #default="{row}">{{row.progress_pct}}%</template></el-table-column>
            <el-table-column prop="assigned_worker" label="工人" width="80" />
          </el-table>
        </el-col>
      </el-row>

      <!-- Scene Data (condensed) -->
      <div v-if="sceneData" style="margin-top:12px;font-size:12px;color:#909399;background:#f5f7fa;padding:8px;border-radius:6px">
        <div>场景生成: {{ sceneData.generated_at }} | IoT 数据点: {{ sceneData.iot_latest?.length||0 }} | 叠加: {{ sceneData.overlay?.length||0 }}</div>
      </div>
    </el-card>

    <!-- Assembly Progress Dashboard -->
    <el-card>
      <template #header><span style="font-weight:600">📊 装配进度总览</span></template>
      <el-table :data="asmOverview" size="small" empty-text="无数据">
        <el-table-column prop="model_name" label="模型" width="200" />
        <el-table-column prop="total_parts" label="总部件" width="80" />
        <el-table-column prop="completed" label="已完成" width="80" />
        <el-table-column prop="in_progress" label="进行中" width="80" />
        <el-table-column prop="pending" label="待开始" width="80" />
        <el-table-column label="进度" min-width="200">
          <template #default="{row}"><el-progress :percentage="row.progress_pct" :status="row.progress_pct===100?'success':''"/></template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Add Model Dialog -->
    <el-dialog v-model="showAddModel" title="注册 3D 模型" width="460px">
      <el-form :model="newModel" label-width="100px" size="small">
        <el-form-item label="编码" required><el-input v-model="newModel.model_code"/></el-form-item>
        <el-form-item label="名称" required><el-input v-model="newModel.model_name"/></el-form-item>
        <el-form-item label="格式"><el-select v-model="newModel.file_format" style="width:100%"><el-option v-for="f in ['glb','gltf','obj','fbx','stp']" :key="f" :label="f" :value="f"/></el-select></el-form-item>
        <el-form-item label="面数"><el-input-number v-model="newModel.polygon_count" :min="0" :step="10000" style="width:100%"/></el-form-item>
        <el-form-item label="包围盒"><el-input v-model="newModel.bounding_box" placeholder='{"x":4.2,"y":4.5,"z":85}'/></el-form-item>
        <el-form-item label="缩放"><el-input-number v-model="newModel.scale_factor" :min="0.01" :max="100" :step="0.1"/></el-form-item>
      </el-form>
      <template #footer><el-button @click="showAddModel=false">取消</el-button><el-button type="primary" @click="addModel" :loading="saving">确定</el-button></template>
    </el-dialog>

    <!-- Add Part Dialog -->
    <el-dialog v-model="showAddPart" title="添加部件映射" width="460px">
      <el-form :model="newPart" label-width="100px" size="small">
        <el-form-item label="名称" required><el-input v-model="newPart.part_name"/></el-form-item>
        <el-form-item label="Mesh名"><el-input v-model="newPart.mesh_name"/></el-form-item>
        <el-form-item label="位置 X"><el-input-number v-model="newPart.position_x" :precision="2" style="width:100%"/></el-form-item>
        <el-form-item label="位置 Y"><el-input-number v-model="newPart.position_y" :precision="2" style="width:100%"/></el-form-item>
        <el-form-item label="位置 Z"><el-input-number v-model="newPart.position_z" :precision="2" style="width:100%"/></el-form-item>
        <el-form-item label="颜色"><el-color-picker v-model="newPart.color_hex"/></el-form-item>
        <el-form-item label="装配工序"><el-input-number v-model="newPart.assembly_step" :min="1" style="width:100%"/></el-form-item>
      </el-form>
      <template #footer><el-button @click="showAddPart=false">取消</el-button><el-button type="primary" @click="addPart" :loading="saving">确定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import Api from '../api'
import { ElMessage } from 'element-plus'

const loading = ref(false); const saving = ref(false)
const models = ref<any[]>([]); const dash = ref<any>({})
const currentModel = ref<any>(null); const currentParts = ref<any[]>([]); const currentAsm = ref<any[]>([])
const sceneData = ref<any>(null); const asmOverview = ref<any[]>([])
const showAddModel = ref(false); const showAddPart = ref(false)

const newModel = reactive({ model_code:'', model_name:'', file_format:'glb', polygon_count:0, bounding_box:'', scale_factor:1.0 })
const newPart = reactive({ part_name:'', mesh_name:'', position_x:0, position_y:0, position_z:0, rotation_x:0, rotation_y:0, rotation_z:0, color_hex:'#888888', assembly_step:1 })

async function refresh() {
  loading.value = true
  try {
    models.value = await Api.get('/dt/models')
    dash.value = await Api.get('/dt/dashboard')
  } catch(e:any) { ElMessage.error('加载失败: ' + (e.response?.data?.error || e.message)) }
  finally { loading.value = false }
}

async function selectModel(row: any) {
  currentModel.value = row
  try {
    const detail = await Api.get(`/api/dt/models/${row.id}`)
    currentParts.value = detail.parts||[]
    currentAsm.value = detail.assembly_status||[]
    const prog = await Api.get(`/api/dt/assembly-progress/${row.id}`)
    asmOverview.value = [prog]
  } catch(e:any) { ElMessage.error(e.message) }
}

async function loadScene() {
  if (!currentModel.value) return
  try { sceneData.value = await Api.get(`/api/dt/scene/${currentModel.value.id}`); ElMessage.success('场景加载完成') }
  catch(e:any) { ElMessage.error(e.message) }
}

async function addModel() {
  saving.value = true
  try { await Api.post('/dt/models', newModel); showAddModel.value = false; Object.assign(newModel,{model_code:'',model_name:'',polygon_count:0,bounding_box:''}); await refresh(); ElMessage.success('模型注册成功') }
  catch(e:any) { ElMessage.error(e.message) }
  finally { saving.value = false }
}

async function addPart() {
  if (!currentModel.value) return
  saving.value = true
  try { await Api.post(`/api/dt/models/${currentModel.value.id}/parts`, newPart); showAddPart.value = false; await selectModel(currentModel.value); ElMessage.success('部件添加成功') }
  catch(e:any) { ElMessage.error(e.message) }
  finally { saving.value = false }
}

onMounted(refresh)
</script>

<style scoped>
.page { padding: 16px }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px }
.page-title { font-size: 20px; font-weight: 700 }
.stat-card { background: #f5f7fa; border-radius: 8px; padding: 16px; text-align: center }
.stat-label { font-size: 12px; color: #909399 }
.stat-value { font-size: 28px; font-weight: 700; margin: 4px 0 }
</style>