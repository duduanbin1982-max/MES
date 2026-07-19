<template>
  <div class="page"><div class="page-header"><div class="page-title"><el-icon><Search /></el-icon> 端到端追溯</div></div>
  <el-tabs v-model="tab">
    <!-- 正向追溯: 物料→工单→设备 -->
    <el-tab-pane label="正向追溯 (物料→设备)" name="forward">
      <div class="toolbar">
        <el-input aria-label="批次号/物料编码" v-model="fw.lot_no" placeholder="批次号/物料编码" @keyup.enter="doForward" style="width:240px" clearable />
        <el-button type="primary" @click="doForward" :loading="fw.loading">追溯</el-button>
      </div>
      <div v-if="fw.result">
        <el-tag :type="fw.result.found?'success':'info'" size="large" style="margin-bottom:12px">{{ fw.result.found ? '找到 '+fw.result.lots.length+' 个批次' : fw.result.message }}</el-tag>
        <div v-for="lot in fw.result.lots" :key="lot.lot_id" style="margin-bottom:20px">
          <el-card shadow="hover"><template #header><b>批次: {{ lot.lot_no }}</b> · {{ lot.material?.material_code }} {{ lot.material?.material_name }} · 供应商: {{ lot.supplier || '-' }}</template>
            <el-descriptions :column="3" border size="small">
              <el-descriptions-item label="炉号">{{ lot.heat_no || '-' }}</el-descriptions-item>
              <el-descriptions-item label="质证书">{{ lot.certificate_no || '-' }}</el-descriptions-item>
              <el-descriptions-item label="质量状态"><el-tag :type="lot.quality_status==='pass'?'success':'danger'" size="small">{{ lot.quality_status }}</el-tag></el-descriptions-item>
            </el-descriptions>
            <div v-if="lot.usage?.length" style="margin-top:12px"><b>使用记录:</b>
              <el-table :data="lot.usage" size="small" border style="margin-top:8px">
                <el-table-column prop="date" label="日期" width="110" />
                <el-table-column label="工单" min-width="140"><template #default="{row}">{{ row.work_order?.code || '-' }} {{ row.work_order?.title || '' }}</template></el-table-column>
                <el-table-column label="设备" min-width="160"><template #default="{row}">{{ row.equipment?.code || '-' }} {{ row.equipment?.name || '' }}</template></el-table-column>
                <el-table-column prop="quantity" label="数量" width="80" align="right" />
                <el-table-column label="类型" width="70"><template #default="{row}"><el-tag size="small">{{ row.movement_type }}</el-tag></template></el-table-column>
              </el-table>
            </div>
            <div v-if="lot.welds?.length" style="margin-top:12px"><b>焊缝:</b>
              <el-table :data="lot.welds" size="small" border><el-table-column prop="weld_no" label="焊口号"/><el-table-column prop="welder" label="焊工"/><el-table-column prop="procedure" label="工艺"/><el-table-column label="结果"><template #default="{row}"><el-tag :type="row.inspection==='pass'?'success':'danger'" size="small">{{ row.inspection }}</el-tag></template></el-table-column></el-table>
            </div>
          </el-card>
        </div>
      </div>
            <div v-if="fw.result?.equipment_instances?.length" style="margin-top:12px">
        <b>关联设备实例:</b>
        <el-table :data="fw.result.equipment_instances" size="small" border style="margin-top:8px">
          <el-table-column prop="instance_code" label="设备编码" width="140" />
          <el-table-column prop="instance_name" label="设备名称" min-width="140" />
          <el-table-column prop="customer" label="客户" width="100" />
          <el-table-column prop="status" label="状态" width="80">
            <template #default="{row}"><el-tag size="small" :type="row.status==='completed'?'success':'info'">{{ row.status }}</el-tag></template>
          </el-table-column>
        </el-table>
      </div>
      <el-empty v-if="!fw.result && !fw.loading" description="输入批次号或物料编码开始追溯" />
    </el-tab-pane>

    <!-- 反向追溯: 设备→全部物料/工单/人员 -->
    <el-tab-pane label="反向追溯 (设备→物料)" name="backward">
      <div class="toolbar">
        <el-select v-model="bw.instance_id" placeholder="选择设备实例" filterable @change="doBackward" style="width:320px">
          <el-option v-for="i in instances" :key="i.id" :label="i.instance_code+' '+ (i.instance_name||'')" :value="i.id" />
        </el-select>
        <el-button type="primary" @click="doBackward" :loading="bw.loading">追溯</el-button>
        <el-button @click="doMatrix" :loading="bw.mloading">追溯矩阵</el-button>
      </div>
      <div v-if="bw.result?.equipment">
        <el-card shadow="hover" style="margin-bottom:16px">
          <template #header><b>{{ bw.result.equipment.code }}</b> · {{ bw.result.equipment.name }} · 客户: {{ bw.result.equipment.customer }}</template>
          <el-tag>{{ bw.result.work_orders?.length || 0 }} 个工单</el-tag>
        </el-card>
        <el-collapse v-if="bw.result.work_orders?.length">
          <el-collapse-item v-for="wo in bw.result.work_orders" :key="wo.id" :title="wo.code+' '+wo.title+' ['+wo.status+']'">
            <div v-if="wo.materials?.length"><b>所用物料批次:</b>
              <el-table :data="wo.materials" size="small" border style="margin-top:8px">
                <el-table-column prop="lot_no" label="批次号" width="120"/><el-table-column prop="material_code" label="物料编码" width="100"/><el-table-column prop="material_name" label="名称"/><el-table-column prop="quantity" label="数量" width="70"/><el-table-column prop="supplier" label="供应商" width="100"/><el-table-column prop="heat_no" label="炉号" width="80"/>
              </el-table>
            </div>
            <div v-if="wo.welds?.length" style="margin-top:8px"><b>焊缝:</b> <span v-for="w in wo.welds" :key="w.weld_no"><el-tag size="small" :type="w.result==='pass'?'success':'danger'">{{ w.weld_no }}·{{ w.welder }}</el-tag> </span></div>
          </el-collapse-item>
        </el-collapse>
      </div>
            <div v-if="bw.result?.materials_tree?.length" style="margin-top:12px">
        <b>物料树:</b>
        <el-tree :data="bw.result.materials_tree" :props="{children:'children',label:'label'}" node-key="id" style="margin-top:8px;background:var(--el-bg-color);padding:8px;border-radius:4px">
          <template #default="{data}">
            <span style="display:flex;align-items:center;gap:8px">
              <span>{{ data.label }}</span>
              <span v-if="data.lot_no" style="color:var(--el-color-info);font-size:11px">{{ data.lot_no }}</span>
              <el-tag v-if="data.qc_result" :type="data.qc_result==='pass'?'success':'danger'" size="small">{{ data.qc_result==='pass'?'OK':'NG' }}</el-tag>
            </span>
          </template>
        </el-tree>
      </div>
      <el-empty v-if="!bw.result && !bw.loading" description="选择设备实例开始反向追溯" />
    </el-tab-pane>

    <!-- 追溯树视图 -->
    <el-tab-pane label="追溯树视图" name="tree">
      <div class="toolbar">
        <el-select v-model="treeFilter.instance_id" placeholder="选择设备实例" filterable style="width:320px" @change="loadTraceTree">
          <el-option v-for="i in instances" :key="i.id" :label="i.instance_code+' '+(i.instance_name||'')" :value="i.id" />
        </el-select>
        <el-button-group>
          <el-button @click="expandAll">展开全部</el-button>
          <el-button @click="collapseAll">收起全部</el-button>
        </el-button-group>
      </div>

      <el-card v-loading="treeLoading" v-if="treeData.length">
        <el-tree :data="treeData" :props="treeProps" node-key="id" default-expand-all ref="treeRef" @node-click="onTreeNodeClick">
          <template #default="{node,data}">
            <span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:500">{{ data.name || data.label }}</span>
              <span v-if="data.material_code" style="color:var(--el-color-info);font-size:12px">{{ data.material_code }}</span>
              <span v-if="data.lot_no" style="color:var(--el-text-color-regular);font-size:12px">批次:{{ data.lot_no }}</span>
              <span v-if="data.supplier" style="color:var(--el-color-info);font-size:11px">{{ data.supplier }}</span>
              <el-tag v-if="data.qc_result" :type="data.qc_result==='pass'?'success':data.qc_result==='fail'?'danger':'warning'" size="small">{{ data.qc_result==='pass'?'合格':data.qc_result==='fail'?'不合格':'待检' }}</el-tag>
            </span>
          </template>
        </el-tree>
      </el-card>
      <el-empty v-if="!treeLoading && !treeData.length" description="选择设备实例查看追溯树" />

      <el-dialog v-model="treeDetailVisible" title="节点详情" width="550px">
        <el-descriptions v-if="treeDetail" :column="2" border size="small">
          <el-descriptions-item label="名称">{{ treeDetail.name }}</el-descriptions-item>
          <el-descriptions-item label="物料编码">{{ treeDetail.material_code || '-' }}</el-descriptions-item>
          <el-descriptions-item label="批次号">{{ treeDetail.lot_no || '-' }}</el-descriptions-item>
          <el-descriptions-item label="供应商">{{ treeDetail.supplier || '-' }}</el-descriptions-item>
          <el-descriptions-item label="炉号">{{ treeDetail.heat_no || '-' }}</el-descriptions-item>
          <el-descriptions-item label="质证书">{{ treeDetail.certificate_no || '-' }}</el-descriptions-item>
          <el-descriptions-item label="质检结果">
            <el-tag :type="treeDetail.qc_result==='pass'?'success':treeDetail.qc_result==='fail'?'danger':'warning'" size="small">{{ treeDetail.qc_result || '待检' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="质检员">{{ treeDetail.inspector || '-' }}</el-descriptions-item>
          <el-descriptions-item label="质检日期" :span="2">{{ treeDetail.qc_date || '-' }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ treeDetail.notes || '-' }}</el-descriptions-item>
        </el-descriptions>
      </el-dialog>
    </el-tab-pane>

    <!-- 追溯证书 -->
    <el-tab-pane label="追溯证书" name="certificate">
      <div class="toolbar">
        <el-select v-model="certFilter.instance_id" placeholder="选择设备实例" filterable style="width:320px" @change="loadCertificate">
          <el-option v-for="i in instances" :key="i.id" :label="i.instance_code+' '+(i.instance_name||'')" :value="i.id" />
        </el-select>
        <el-button v-if="certData" @click="printCertificate" type="primary">打印证书</el-button>
      </div>

      <div v-if="certData" id="certificate-print-area" style="background:var(--el-color-white);border:2px solid var(--el-text-color-primary);padding:24px;max-width:800px">
        <div style="text-align:center;margin-bottom:20px">
          <h2 style="margin:0">产品质量追溯证书</h2>
          <p style="color:var(--el-color-info);margin:4px 0">Quality Traceability Certificate</p>
        </div>
        <el-descriptions :column="2" border size="small" style="margin-bottom:16px">
          <el-descriptions-item label="设备编码">{{ certData.instance_code }}</el-descriptions-item>
          <el-descriptions-item label="设备名称">{{ certData.instance_name }}</el-descriptions-item>
          <el-descriptions-item label="客户">{{ certData.customer || '-' }}</el-descriptions-item>
          <el-descriptions-item label="完工日期">{{ certData.completion_date || '-' }}</el-descriptions-item>
          <el-descriptions-item label="签发日期" :span="2">{{ certData.issue_date || '-' }}</el-descriptions-item>
        </el-descriptions>

        <h4 style="margin:16px 0 8px">关键物料清单</h4>
        <el-table :data="certData.materials || []" border size="small" max-height="300">
          <el-table-column prop="material_code" label="物料编码" width="120" />
          <el-table-column prop="material_name" label="物料名称" min-width="120" />
          <el-table-column prop="lot_no" label="批次号" width="120" />
          <el-table-column prop="supplier" label="供应商" width="100" />
          <el-table-column prop="heat_no" label="炉号" width="80" />
          <el-table-column label="质检" width="70">
            <template #default="{row}"><el-tag :type="row.qc_result==='pass'?'success':'danger'" size="small">{{ row.qc_result==='pass'?'合格':'不合格' }}</el-tag></template>
          </el-table-column>
        </el-table>

        <h4 style="margin:16px 0 8px">质检总结</h4>
        <p style="color:var(--el-text-color-regular);line-height:1.6">{{ certData.qc_summary || '所有关键物料已通过入厂检验，生产过程符合工艺规范。' }}</p>

        <div style="margin-top:20px;display:flex;justify-content:space-between">
          <div><b>质检员:</b> {{ (certData.inspectors || []).join(', ') || '-' }}</div>
          <div><b>签发人:</b> {{ certData.issuer || '-' }}</div>
        </div>
      </div>
      <el-empty v-if="!certData" description="选择设备实例查看追溯证书" />
    </el-tab-pane>

    <el-tab-pane label="追溯登记" name="records">
      <div class="toolbar">
        <el-select v-model="recordFilter.instance_id" placeholder="选择设备实例" filterable style="width:320px" @change="loadRecordWorkspace">
          <el-option v-for="i in instances" :key="i.id" :label="i.instance_code+' '+(i.instance_name||'')" :value="i.id" />
        </el-select>
        <el-button @click="loadRecordWorkspace" :loading="recordLoading">刷新</el-button>
      </div>
      <el-empty v-if="!recordFilter.instance_id" description="先选择设备实例" />
      <template v-else>
        <el-row :gutter="12">
          <el-col :xs="24" :lg="8">
            <el-card shadow="never"><template #header><b>序列号建档</b></template>
              <el-form label-position="top" :model="serialForm">
                <el-form-item label="序列号"><el-input v-model="serialForm.serial_no" placeholder="扫描或输入铭牌序列号" /></el-form-item>
                <el-form-item label="物料批次"><el-select v-model="serialForm.lot_id" filterable style="width:100%"><el-option v-for="lot in recordContext.lots" :key="lot.id" :value="lot.id" :label="lot.lot_no+' · '+lot.material_code+' '+lot.material_name" /></el-select></el-form-item>
                <el-form-item label="备注"><el-input v-model="serialForm.notes" /></el-form-item>
                <el-button type="primary" @click="createSerial">建档</el-button>
              </el-form>
            </el-card>
          </el-col>
          <el-col :xs="24" :lg="8">
            <el-card shadow="never"><template #header><b>装配步骤登记</b></template>
              <el-form label-position="top" :model="assemblyForm">
                <el-form-item label="工单"><el-select v-model="assemblyForm.work_order_id" filterable style="width:100%"><el-option v-for="wo in recordContext.work_orders" :key="wo.id" :value="wo.id" :label="wo.wo_code+' · '+wo.title" /></el-select></el-form-item>
                <el-row :gutter="8"><el-col :span="8"><el-form-item label="步骤号"><el-input-number v-model="assemblyForm.step_no" :min="1" style="width:100%" /></el-form-item></el-col><el-col :span="16"><el-form-item label="步骤名称"><el-input v-model="assemblyForm.step_name" /></el-form-item></el-col></el-row>
                <el-row :gutter="8"><el-col :span="12"><el-form-item label="扭矩 N·m"><el-input-number v-model="assemblyForm.torque_value_nm" :min="0" style="width:100%" /></el-form-item></el-col><el-col :span="12"><el-form-item label="间隙 mm"><el-input-number v-model="assemblyForm.clearance_mm" :min="0" :precision="3" style="width:100%" /></el-form-item></el-col></el-row>
                <el-button type="primary" @click="createAssembly">登记</el-button>
              </el-form>
            </el-card>
          </el-col>
          <el-col :xs="24" :lg="8">
            <el-card shadow="never"><template #header><b>NDT 登记</b></template>
              <el-form label-position="top" :model="ndtForm">
                <el-form-item label="焊缝"><el-select v-model="ndtForm.weld_record_id" filterable style="width:100%" @change="syncNdtWorkOrder"><el-option v-for="w in recordContext.welds" :key="w.id" :value="w.id" :label="w.wo_code+' · '+w.weld_no" /></el-select></el-form-item>
                <el-row :gutter="8"><el-col :span="12"><el-form-item label="方法"><el-select v-model="ndtForm.ndt_method" style="width:100%"><el-option v-for="m in ['UT','RT','MT','PT']" :key="m" :value="m" /></el-select></el-form-item></el-col><el-col :span="12"><el-form-item label="结果"><el-segmented v-model="ndtForm.result" :options="[{label:'合格',value:'pass'},{label:'不合格',value:'fail'}]" /></el-form-item></el-col></el-row>
                <el-form-item label="报告编号"><el-input v-model="ndtForm.report_no" placeholder="附件请到文档管理上传" /></el-form-item>
                <el-button type="primary" @click="createNdt">登记</el-button>
              </el-form>
            </el-card>
          </el-col>
        </el-row>
        <el-tabs class="record-lists">
          <el-tab-pane :label="'序列号 '+recordData.serials.length"><el-table :data="recordData.serials" size="small" border><el-table-column prop="serial_no" label="序列号"/><el-table-column prop="material_code" label="物料"/><el-table-column prop="lot_no" label="批次"/><el-table-column prop="status" label="状态"/></el-table></el-tab-pane>
          <el-tab-pane :label="'装配 '+recordData.assemblies.length"><el-table :data="recordData.assemblies" size="small" border><el-table-column prop="wo_code" label="工单"/><el-table-column prop="step_no" label="步骤" width="70"/><el-table-column prop="step_name" label="名称"/><el-table-column prop="operator_name" label="操作人"/><el-table-column prop="assembly_date" label="时间"/></el-table></el-tab-pane>
          <el-tab-pane :label="'NDT '+recordData.ndt.length"><el-table :data="recordData.ndt" size="small" border><el-table-column prop="wo_code" label="工单"/><el-table-column prop="weld_no" label="焊缝"/><el-table-column prop="ndt_method" label="方法"/><el-table-column prop="result" label="结果"/><el-table-column prop="report_no" label="报告编号"/></el-table></el-tab-pane>
        </el-tabs>
      </template>
    </el-tab-pane>

  </el-tabs></div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Api } from '../api'
import type { ApiRecord } from '../types/api'

const tab = ref('forward')
const instances = ref<ApiRecord[]>([])
onMounted(async () => { try { instances.value = await Api.instances() } catch(_){} })

const fw = reactive<{ lot_no: string; loading: boolean; result: ApiRecord | null }>({ lot_no: '', loading: false, result: null })
const doForward = async () => { if(!fw.lot_no) return; fw.loading=true; try { fw.result = await Api.get('/trace/forward',{params:{lot_no:fw.lot_no}}) } catch(_){ fw.result=null } finally { fw.loading=false } }

const bw = reactive<{ instance_id: number | null; loading: boolean; mloading: boolean; result: ApiRecord | null; matrix: ApiRecord | null }>({ instance_id: null, loading: false, mloading: false, result: null, matrix: null })
const doBackward = async () => { if(!bw.instance_id) return; bw.loading=true; try { bw.result = await Api.get('/trace/backward',{params:{instance_id:bw.instance_id}}) } catch(_){ bw.result=null } finally { bw.loading=false } }

// Tab: 追溯树视图
const treeFilter = reactive({ instance_id: null as number | null })
const treeData = ref<any[]>([])
const treeLoading = ref(false)
const treeRef = ref()
const treeProps = { children: 'children', label: 'name' }
const treeDetailVisible = ref(false)
const treeDetail = ref<any>(null)

const loadTraceTree = async () => {
  if (!treeFilter.instance_id) { treeData.value = []; return }
  treeLoading.value = true
  try {
    const r = await Api.get('/trace/tree/' + treeFilter.instance_id)
    treeData.value = Array.isArray(r) ? r : (r?.tree || r?.data || [])
  } catch (_) { treeData.value = [] }
  finally { treeLoading.value = false }
}

const expandAll = () => { treeRef.value?.store?.nodesMap && Object.values(treeRef.value.store.nodesMap).forEach((n:any) => n.expand()) }
const collapseAll = () => { treeRef.value?.store?.nodesMap && Object.values(treeRef.value.store.nodesMap).forEach((n:any) => n.collapse()) }

const onTreeNodeClick = (data: any) => {
  treeDetail.value = data
  treeDetailVisible.value = true
}

// Tab: 追溯证书
const certFilter = reactive({ instance_id: null as number | null })
const certData = ref<any>(null)

const loadCertificate = async () => {
  if (!certFilter.instance_id) { certData.value = null; return }
  try {
    certData.value = await Api.get('/trace/certificate/' + certFilter.instance_id)
  } catch (_) { certData.value = null }
}

const printCertificate = () => {
  window.print()
}

const recordFilter = reactive({ instance_id: null as number | null })
const recordLoading = ref(false)
const recordContext = reactive<any>({ work_orders: [], lots: [], welds: [], users: [] })
const recordData = reactive<any>({ serials: [], assemblies: [], ndt: [] })
const serialForm = reactive<any>({ serial_no: '', lot_id: null, notes: '' })
const assemblyForm = reactive<any>({ work_order_id: null, step_no: 1, step_name: '', torque_value_nm: null, clearance_mm: null })
const ndtForm = reactive<any>({ work_order_id: null, weld_record_id: null, ndt_method: 'UT', result: 'pass', report_no: '' })

const loadRecordWorkspace = async () => {
  if (!recordFilter.instance_id) return
  recordLoading.value = true
  try {
    const [context, records] = await Promise.all([
      Api.get('/trace/context', { params: { instance_id: recordFilter.instance_id } }),
      Api.get('/trace/records', { params: { instance_id: recordFilter.instance_id } }),
    ])
    Object.assign(recordContext, context)
    Object.assign(recordData, records)
  } finally { recordLoading.value = false }
}

const createSerial = async () => {
  if (!serialForm.serial_no || !serialForm.lot_id) return ElMessage.warning('请选择批次并填写序列号')
  await Api.post('/trace/serials', { ...serialForm, equipment_instance_id: recordFilter.instance_id })
  Object.assign(serialForm, { serial_no: '', lot_id: null, notes: '' })
  ElMessage.success('序列号已建档')
  await loadRecordWorkspace()
}

const createAssembly = async () => {
  if (!assemblyForm.work_order_id || !assemblyForm.step_name) return ElMessage.warning('请选择工单并填写步骤名称')
  await Api.post('/trace/assembly-records', assemblyForm)
  assemblyForm.step_no += 1
  assemblyForm.step_name = ''
  ElMessage.success('装配步骤已登记')
  await loadRecordWorkspace()
}

const syncNdtWorkOrder = (weldId: number) => {
  ndtForm.work_order_id = recordContext.welds.find((item:any) => item.id === weldId)?.work_order_id || null
}

const createNdt = async () => {
  if (!ndtForm.weld_record_id || !ndtForm.work_order_id) return ElMessage.warning('请选择焊缝')
  await Api.post('/trace/ndt-records', ndtForm)
  ndtForm.weld_record_id = null
  ndtForm.work_order_id = null
  ndtForm.report_no = ''
  ElMessage.success('NDT 结果已登记')
  await loadRecordWorkspace()
}

const doMatrix = async () => { if(!bw.instance_id) return; bw.mloading=true; try { bw.matrix = await Api.get('/trace/matrix',{params:{instance_id:bw.instance_id}}) } catch(_){} finally { bw.mloading=false } }
</script>

<style scoped>.page{padding:16px 24px}.page-header{margin-bottom:16px}.page-title{font-size:20px;font-weight:600}.toolbar{display:flex;gap:10px;align-items:center;margin-bottom:16px}.record-lists{margin-top:16px}@media print {
  body * { visibility: hidden; }
  #certificate-print-area, #certificate-print-area * { visibility: visible; }
  #certificate-print-area { position: absolute; left: 0; top: 0; width: 100%; }
}
</style>
