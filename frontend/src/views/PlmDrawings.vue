<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">📐 PLM 图纸管理</div>
      <div style="display:flex;gap:8px">
        <el-button type="primary" @click="showAddDwg=true">+ 新建图纸</el-button>
        <el-button type="success" @click="showAddEco=true" :disabled="!currentDwg">+ ECO 变更</el-button>
        <el-button @click="refresh" :loading="loading">刷新</el-button>
      </div>
    </div>

    <!-- Dashboard -->
    <el-row :gutter="12" style="margin-bottom:12px">
      <el-col :span="6"><div class="stat-card"><div class="stat-label">图纸总数</div><div class="stat-value">{{ dash.drawings?.total||0 }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">已签发</div><div class="stat-value" style="color:#67c23a">{{ dash.drawings?.issued||0 }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">待审批 ECO</div><div class="stat-value" style="color:#e6a23c">{{ dash.eco?.pending||0 }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">按状态</div><div class="stat-value" style="font-size:12px;color:#909399" v-for="s in dash.by_status||[]" :key="s.status">{{s.status}}:{{s.cnt}}&nbsp;</div></div></el-col>
    </el-row>

    <!-- Drawings Table -->
    <el-card style="margin-bottom:12px">
      <template #header><span style="font-weight:600">📋 图纸列表</span></template>
      <el-table :data="drawings" stripe size="small" @row-click="selectDwg" highlight-current-row empty-text="暂无图纸">
        <el-table-column prop="drawing_no" label="图号" width="160" />
        <el-table-column prop="title" label="标题" min-width="180" />
        <el-table-column prop="revision" label="版本" width="60" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{row}"><el-tag :type="row.status==='issued'?'success':row.status==='superseded'?'info':'warning'" size="small">{{ row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="designer" label="设计" width="80" />
        <el-table-column prop="cad_software" label="CAD" width="120" />
        <el-table-column label="操作" width="200">
          <template #default="{row}">
            <el-button size="small" v-if="row.status==='draft'" type="success" @click.stop="issueDwg(row.id)">签发</el-button>
            <el-button size="small" type="primary" @click.stop="reviseDwg(row)">升版</el-button>
            <el-button size="small" @click.stop="extractBom(row.id)" :loading="extracting">提取BOM</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Drawing Detail -->
    <el-card v-if="currentDwg" style="margin-bottom:12px">
      <template #header><span style="font-weight:600">🔍 {{ currentDwg.drawing_no }} 详情</span></template>
      <el-descriptions :column="3" size="small" border>
        <el-descriptions-item label="图号">{{ currentDwg.drawing_no }}</el-descriptions-item>
        <el-descriptions-item label="版本">{{ currentDwg.revision }}</el-descriptions-item>
        <el-descriptions-item label="状态"><el-tag size="small">{{ currentDwg.status }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="设计">{{ currentDwg.designer }}</el-descriptions-item>
        <el-descriptions-item label="审核">{{ currentDwg.reviewer||'-' }}</el-descriptions-item>
        <el-descriptions-item label="CAD软件">{{ currentDwg.cad_software||'-' }}</el-descriptions-item>
        <el-descriptions-item label="图幅">{{ currentDwg.sheet_size||'-' }}</el-descriptions-item>
        <el-descriptions-item label="比例">{{ currentDwg.scale||'-' }}</el-descriptions-item>
        <el-descriptions-item label="签发日期">{{ currentDwg.effective_date||'-' }}</el-descriptions-item>
      </el-descriptions>
      <div v-if="currentDwg.cad_meta" style="margin-top:8px">
        <el-tag size="small" type="info">CAD BOM: {{ currentDwg.cad_meta.part_count }} 个零件</el-tag>
        <div style="font-size:12px;color:#909399;margin-top:4px">{{ currentDwg.cad_meta.extracted_bom_json?.substring(0,200) }}</div>
      </div>
      <div v-if="currentDwg.versions?.length>1" style="margin-top:8px">
        <div style="font-weight:600;margin-bottom:4px">历史版本</div>
        <el-tag v-for="v in currentDwg.versions" :key="v.id" size="small" style="margin:2px">{{ v.revision }} ({{ v.status }})</el-tag>
      </div>
    </el-card>

    <!-- ECO Panel -->
    <el-card>
      <template #header><span style="font-weight:600;color:#e6a23c">🔄 工程变更 (ECO)</span></template>
      <el-table :data="ecos" size="small" empty-text="暂无变更">
        <el-table-column prop="eco_no" label="编号" width="110" />
        <el-table-column prop="title" label="标题" min-width="180" />
        <el-table-column prop="drawing_no" label="关联图纸" width="150" />
        <el-table-column prop="change_type" label="类型" width="80" />
        <el-table-column label="状态" width="90">
          <template #default="{row}"><el-tag :type="row.status==='approved'?'success':row.status==='implemented'?'':'warning'" size="small">{{ row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="old_revision" label="旧版本" width="70" />
        <el-table-column prop="new_revision" label="新版本" width="70" />
        <el-table-column label="操作" width="120">
          <template #default="{row}">
            <el-button v-if="row.status==='draft'" size="small" type="success" @click="approveEco(row.id)">批准</el-button>
            <el-button v-if="row.status==='approved'" size="small" type="primary" @click="implementEco(row.id)">实施</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Add Drawing Dialog -->
    <el-dialog v-model="showAddDwg" title="新建图纸" width="480px">
      <el-form :model="newDwg" label-width="100px" size="small">
        <el-form-item label="图号" required><el-input v-model="newDwg.drawing_no"/></el-form-item>
        <el-form-item label="标题" required><el-input v-model="newDwg.title"/></el-form-item>
        <el-form-item label="CAD软件"><el-select v-model="newDwg.cad_software" style="width:100%"><el-option v-for="c in ['SolidWorks','Inventor','AutoCAD','NX','Creo']" :key="c" :label="c" :value="c"/></el-select></el-form-item>
        <el-form-item label="图幅"><el-select v-model="newDwg.sheet_size" style="width:100%"><el-option v-for="s in ['A0','A1','A2','A3','A4']" :key="s" :label="s" :value="s"/></el-select></el-form-item>
        <el-form-item label="比例"><el-input v-model="newDwg.scale" placeholder="1:10"/></el-form-item>
        <el-form-item label="设计者"><el-input v-model="newDwg.designer"/></el-form-item>
        <el-form-item label="审核者"><el-input v-model="newDwg.reviewer"/></el-form-item>
      </el-form>
      <template #footer><el-button @click="showAddDwg=false">取消</el-button><el-button type="primary" @click="addDwg" :loading="saving">确定</el-button></template>
    </el-dialog>

    <!-- Add ECO Dialog -->
    <el-dialog v-model="showAddEco" title="提交工程变更" width="480px">
      <el-form :model="newEco" label-width="100px" size="small">
        <el-form-item label="标题" required><el-input v-model="newEco.title"/></el-form-item>
        <el-form-item label="变更类型"><el-select v-model="newEco.change_type" style="width:100%"><el-option label="设计变更" value="design"/><el-option label="工艺变更" value="process"/><el-option label="材料变更" value="material"/></el-select></el-form-item>
        <el-form-item label="原因"><el-input v-model="newEco.reason"/></el-form-item>
        <el-form-item label="旧版本"><el-input v-model="newEco.old_revision"/></el-form-item>
        <el-form-item label="新版本"><el-input v-model="newEco.new_revision"/></el-form-item>
        <el-form-item label="申请人"><el-input v-model="newEco.requested_by"/></el-form-item>
      </el-form>
      <template #footer><el-button @click="showAddEco=false">取消</el-button><el-button type="primary" @click="addEco" :loading="saving">确定</el-button></template>
    </el-dialog>

    <!-- Revise Dialog -->
    <el-dialog v-model="showRevise" title="图纸升版" width="360px">
      <el-form label-width="100px" size="small">
        <el-form-item label="当前版本"><el-tag>{{ reviseDwgData.revision }}</el-tag></el-form-item>
        <el-form-item label="新版本"><el-input v-model="newRevision" /></el-form-item>
        <el-form-item label="变更原因"><el-input v-model="reviseReason" type="textarea"/></el-form-item>
      </el-form>
      <template #footer><el-button @click="showRevise=false">取消</el-button><el-button type="primary" @click="doRevise" :loading="saving">确定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import Api from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const loading = ref(false); const saving = ref(false); const extracting = ref(false)
const drawings = ref<any[]>([]); const ecos = ref<any[]>([]); const dash = ref<any>({})
const currentDwg = ref<any>(null)
const showAddDwg = ref(false); const showAddEco = ref(false); const showRevise = ref(false)
const reviseDwgData = ref<any>({}); const newRevision = ref(''); const reviseReason = ref('')

const newDwg = reactive({ drawing_no:'', title:'', cad_software:'', sheet_size:'A1', scale:'', designer:'', reviewer:'' })
const newEco = reactive({ title:'', change_type:'design', reason:'', old_revision:'', new_revision:'', requested_by:'', drawing_id:0 })

async function refresh() {
  loading.value = true
  try {
    drawings.value = await Api.get('/plm/drawings')
    ecos.value = await Api.get('/plm/ecos')
    dash.value = await Api.get('/plm/dashboard')
  } catch(e:any) { ElMessage.error(e.message) }
  finally { loading.value = false }
}

async function selectDwg(row: any) {
  try { currentDwg.value = await Api.get(`/api/plm/drawings/${row.id}`) }
  catch(e:any) { ElMessage.error(e.message) }
}

async function addDwg() {
  saving.value = true
  try { await Api.post('/plm/drawings', newDwg); showAddDwg.value = false; Object.assign(newDwg,{drawing_no:'',title:'',designer:'',reviewer:''}); await refresh(); ElMessage.success('创建成功') }
  catch(e:any) { ElMessage.error(e.message) }
  finally { saving.value = false }
}

async function issueDwg(id: number) {
  try {
    const name = await ElMessageBox.prompt('签批人', '签发图纸', {confirmButtonText:'签发'})
    await Api.put(`/api/plm/drawings/${id}/issue`, { approved_by: name.value })
    ElMessage.success('签发成功'); await refresh()
  } catch {}
}

async function reviseDwg(row: any) {
  reviseDwgData.value = row; newRevision.value = ''; reviseReason.value = ''; showRevise.value = true
}

async function doRevise() {
  saving.value = true
  try {
    await Api.post(`/api/plm/drawings/${reviseDwgData.value.id}/revise`, { new_revision: newRevision.value||undefined, change_reason: reviseReason.value })
    showRevise.value = false; await refresh(); ElMessage.success('升版成功')
  } catch(e:any) { ElMessage.error(e.message) }
  finally { saving.value = false }
}

async function extractBom(id: number) {
  extracting.value = true
  try { const r = await Api.post('/plm/cad-meta/extract-bom', { drawing_id: id }); ElMessage.success(`提取 ${r.parts.length} 个零件`); await selectDwg({id}) }
  catch(e:any) { ElMessage.error(e.message) }
  finally { extracting.value = false }
}

async function addEco() {
  saving.value = true
  try {
    newEco.drawing_id = currentDwg.value?.id||0
    await Api.post('/plm/ecos', newEco); showAddEco.value = false; await refresh(); ElMessage.success('ECO 提交成功')
  } catch(e:any) { ElMessage.error(e.message) }
  finally { saving.value = false }
}

async function approveEco(id: number) {
  try { await Api.put(`/api/plm/ecos/${id}/approve`, {}); ElMessage.success('已批准'); await refresh() }
  catch(e:any) { ElMessage.error(e.message) }
}

async function implementEco(id: number) {
  try { await Api.put(`/api/plm/ecos/${id}/implement`, {}); ElMessage.success('已实施'); await refresh() }
  catch(e:any) { ElMessage.error(e.message) }
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