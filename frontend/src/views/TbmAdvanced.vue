<template>
  <div class="page"><div class="page-header"><div class="page-title"><el-icon><Tools /></el-icon> TBM 非标装备增强</div></div>
  <el-tabs v-model="tab" @tab-change="onTab">
    <!-- ===== Tab 1: 关键件管理 ===== -->
    <el-tab-pane label="关键件管理" name="critical">
      <div class="tb"><el-select v-model="cf.inst" placeholder="装备实例" clearable @change="loadCP" style="width:220px"><el-option v-for="i in instances" :key="i.id" :label="i.instance_code" :value="i.id"/></el-select>
        <el-select v-model="cf.risk" placeholder="风险等级" clearable @change="loadCP" style="width:120px"><el-option label="高" value="high"/><el-option label="中" value="medium"/><el-option label="低" value="low"/></el-select>
        <el-button type="primary" @click="showCPDlg=true">+ 新增关键件</el-button>
      </div>
      <el-table :data="cparts" v-loading="cpLoading" size="small" max-height="400" @row-click="showCPDetail">
        <el-table-column prop="part_code" label="编码" width="100"/><el-table-column prop="part_name" label="名称" min-width="140"/>
        <el-table-column label="类型" width="80"><template #default="{r}"><el-tag size="small">{{{mechanical:'机械',electrical:'电气',hydraulic:'液压',structural:'结构'}[r.part_type]||r.part_type}}</el-tag></template></el-table-column>
        <el-table-column prop="supplier" label="供应商" width="100"/>
        <el-table-column label="风险" width="70"><template #default="{r}"><el-tag :type="r.risk_level==='high'?'danger':r.risk_level==='medium'?'warning':'success'" size="small">{{{high:'高',medium:'中',low:'低'}[r.risk_level]||r.risk_level}}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="100" align="center"><template #default="{r}"><el-button size="small" link type="primary" @click.stop="showCPDetail(r)">详情</el-button></template></el-table-column>
      </el-table>
      <!-- 关键件详情弹窗 -->
      <el-dialog v-model="cpDetail.show" :title="cpDetail.part?.part_code+' '+cpDetail.part?.part_name" width="700px">
        <template v-if="cpDetail.part">
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="图号">{{cpDetail.part.drawing_no||'-'}}</el-descriptions-item><el-descriptions-item label="规格">{{cpDetail.part.spec||'-'}}</el-descriptions-item>
            <el-descriptions-item label="供应商">{{cpDetail.part.supplier||'-'}}</el-descriptions-item><el-descriptions-item label="制造标准">{{cpDetail.part.manufacturing_standard||'-'}}</el-descriptions-item>
          </el-descriptions>
          <h4 style="margin:12px 0 8px">资质证书</h4>
          <el-table :data="cpDetail.certs||[]" size="small" border><el-table-column prop="cert_type" label="类型" width="100"/><el-table-column prop="cert_no" label="编号"/><el-table-column prop="issued_by" label="签发机构" width="120"/><el-table-column prop="issue_date" label="签发日" width="100"/><el-table-column prop="expiry_date" label="到期日" width="100"><template #default="{r}"><span :style="{color:r.expiry_date&&r.expiry_date<today?'var(--el-color-danger)':''}">{{r.expiry_date||'-'}}</span></template></el-table-column><el-table-column label="操作" width="60"><template #default="{r}"><el-button size="small" type="danger" link @click="delCert(r)">删</el-button></template></el-table-column></el-table>
          <el-button size="small" @click="showCertForm=true" style="margin-top:8px">+ 添加证书</el-button>
          <h4 style="margin:12px 0 8px">监造日志</h4>
          <el-table :data="cpDetail.logs||[]" size="small" border max-height="200"><el-table-column prop="log_date" label="日期" width="100"/><el-table-column prop="inspector" label="监造员" width="80"/><el-table-column prop="location" label="地点" width="80"/><el-table-column prop="content" label="内容" min-width="200"/><el-table-column label="状态" width="70"><template #default="{r}"><el-tag :type="r.status==='issue'?'danger':'success'" size="small">{{r.status==='issue'?'异常':'正常'}}</el-tag></template></el-table-column></el-table>
          <el-button size="small" @click="showLogForm=true" style="margin-top:8px">+ 添加日志</el-button>
        </template>
      </el-dialog>
      <!-- 证书表单 -->
      <el-dialog v-model="showCertForm" title="添加证书" width="400px"><el-form :model="certF" label-width="80px"><el-form-item label="类型"><el-select v-model="certF.cert_type" style="width:100%"><el-option label="材质证明" value="material"/><el-option label="合格证" value="certificate"/><el-option label="探伤报告" value="ndt"/><el-option label="其他" value="other"/></el-select></el-form-item><el-form-item label="编号"><el-input v-model="certF.cert_no"/></el-form-item><el-form-item label="签发机构"><el-input v-model="certF.issued_by"/></el-form-item><el-form-item label="签发日"><el-date-picker v-model="certF.issue_date" type="date" value-format="YYYY-MM-DD" style="width:100%"/></el-form-item><el-form-item label="到期日"><el-date-picker v-model="certF.expiry_date" type="date" value-format="YYYY-MM-DD" style="width:100%"/></el-form-item></el-form><template #footer><el-button @click="showCertForm=false">取消</el-button><el-button type="primary" @click="saveCert">保存</el-button></template></el-dialog>
      <!-- 监造日志表单 -->
      <el-dialog v-model="showLogForm" title="添加监造日志" width="400px"><el-form :model="logF" label-width="80px"><el-form-item label="日期"><el-date-picker v-model="logF.log_date" type="date" value-format="YYYY-MM-DD" style="width:100%"/></el-form-item><el-form-item label="监造员"><el-input v-model="logF.inspector"/></el-form-item><el-form-item label="地点"><el-input v-model="logF.location"/></el-form-item><el-form-item label="内容"><el-input v-model="logF.content" type="textarea" :rows="3"/></el-form-item><el-form-item label="状态"><el-select v-model="logF.status" style="width:100%"><el-option label="正常" value="normal"/><el-option label="异常" value="issue"/></el-select></el-form-item></el-form><template #footer><el-button @click="showLogForm=false">取消</el-button><el-button type="primary" @click="saveLog">保存</el-button></template></el-dialog>
    </el-tab-pane>

    <!-- ===== Tab 2: 采购跟催 ===== -->
    <el-tab-pane label="采购跟催" name="purchase">
      <el-row :gutter="16" style="margin-bottom:12px"><el-col :span="6" v-for="s in ptStats" :key="s.l"><el-card shadow="hover"><el-statistic :title="s.l" :value="s.v"><template #suffix><el-tag :type="s.t" size="small">{{s.s}}</el-tag></template></el-statistic></el-card></el-col></el-row>
      <div class="tb"><el-select v-model="ptf.status" placeholder="状态" clearable @change="loadPT" style="width:120px"><el-option label="待交货" value="pending"/><el-option label="已交货" value="delivered"/><el-option label="已取消" value="cancelled"/></el-select><el-button :type="ptf.overdue?'danger':''" @click="ptf.overdue=!ptf.overdue;loadPT()">⏰ 逾期</el-button><el-button type="primary" @click="showPTDlg=true">+ 新增</el-button></div>
      <el-table :data="ptracks" v-loading="ptLoading" size="small" max-height="400">
        <el-table-column prop="item_name" label="物料" min-width="140"/><el-table-column prop="supplier" label="供应商" width="100"/>
        <el-table-column prop="planned_delivery" label="计划交期" width="110"><template #default="{r}"><span :style="{color:r.planned_delivery&&r.planned_delivery<today&&r.status!=='delivered'?'var(--el-color-danger)':''}">{{r.planned_delivery||'-'}}</span></template></el-table-column>
        <el-table-column prop="actual_delivery" label="实际交期" width="110"/>
        <el-table-column label="延期(天)" width="80"><template #default="{r}"><el-tag v-if="r.delay_days>0" type="danger" size="small">{{r.delay_days}}天</el-tag><span v-else style="color:var(--el-color-success)">0</span></template></el-table-column>
        <el-table-column label="状态" width="80"><template #default="{r}"><el-tag :type="r.status==='delivered'?'success':r.status==='cancelled'?'info':r.delay_days>0?'danger':'warning'" size="small">{{{pending:'待交货',delivered:'已交货',cancelled:'已取消'}[r.status]||r.status}}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="100"><template #default="{r}"><el-button size="small" v-if="r.status!=='delivered'" type="success" @click="markDelivered(r)">交货</el-button></template></el-table-column>
      </el-table>
      <el-dialog v-model="showPTDlg" title="新增采购跟催" width="400px"><el-form :model="ptForm" label-width="80px"><el-form-item label="物料"><el-input v-model="ptForm.item_name"/></el-form-item><el-form-item label="供应商"><el-input v-model="ptForm.supplier"/></el-form-item><el-form-item label="计划交期"><el-date-picker v-model="ptForm.planned_delivery" type="date" value-format="YYYY-MM-DD" style="width:100%"/></el-form-item><el-form-item label="备注"><el-input v-model="ptForm.remarks"/></el-form-item></el-form><template #footer><el-button @click="showPTDlg=false">取消</el-button><el-button type="primary" @click="savePT">保存</el-button></template></el-dialog>
    </el-tab-pane>

    <!-- ===== Tab 3: 项目看板 ===== -->
    <el-tab-pane label="项目看板" name="project">
      <div class="tb"><el-select v-model="prj.inst" placeholder="装备实例" filterable @change="loadProject" style="width:280px"><el-option v-for="i in instances" :key="i.id" :label="i.instance_code+' '+ (i.instance_name||'')" :value="i.id"/></el-select></div>
      <div v-if="prj.summary" style="margin-bottom:16px">
        <el-row :gutter="16"><el-col :span="6"><el-card shadow="hover"><el-statistic title="合同金额" :value="prj.summary.contract_amount" prefix="¥"/></el-card></el-col>
        <el-col :span="6"><el-card shadow="hover"><el-statistic title="已收款" :value="prj.summary.total_payment" prefix="¥"/></el-card></el-col>
        <el-col :span="6"><el-card shadow="hover"><el-statistic title="收款率" :value="prj.summary.payment_rate" suffix="%"/></el-card></el-col>
        <el-col :span="6"><el-card shadow="hover"><el-statistic title="里程碑" :value="prj.summary.milestones_completed+'/'+prj.summary.milestones_total"/></el-card></el-col></el-row>
        <el-progress :percentage="prj.summary.payment_rate" :stroke-width="16" style="margin:12px 0"/>
      </div>
      <el-table :data="prj.milestones" size="small" max-height="350">
        <el-table-column prop="milestone_name" label="里程碑" min-width="150"/><el-table-column prop="planned_date" label="计划日期" width="110"/>
        <el-table-column prop="actual_date" label="实际日期" width="110"/><el-table-column prop="payment_pct" label="收款%" width="80" align="right"/><el-table-column prop="payment_amount" label="收款金额" width="120" align="right"><template #default="{r}">¥{{r.payment_amount||0}}</template></el-table-column>
        <el-table-column label="状态" width="80"><template #default="{r}"><el-tag :type="r.status==='completed'?'success':'warning'" size="small">{{r.status==='completed'?'已完成':'待完成'}}</el-tag></template></el-table-column>
        <el-table-column label="收款记录" min-width="150"><template #default="{r}"><span v-for="p in r.payments" :key="p.id"><el-tag size="small" type="success" style="margin:2px">{{p.received_date}} ¥{{p.amount}}</el-tag> </span></template></el-table-column>
        <el-table-column label="操作" width="160" align="center"><template #default="{r}">
          <el-button size="small" @click="openMilestoneEdit(r)">编辑</el-button>
          <el-button size="small" type="success" @click="openPayment(r)">收款</el-button>
        </template></el-table-column>
      </el-table>
      <el-button @click="autoGenMile" style="margin-top:8px">自动生成 S1-S10</el-button>
      <el-button type="primary" @click="showMSDlg=true" style="margin-top:8px">+ 里程碑</el-button>
      <!-- 里程碑编辑 -->
      <el-dialog v-model="showMSDlg" title="里程碑" width="400px"><el-form :model="msForm" label-width="80px"><el-form-item label="名称"><el-input v-model="msForm.milestone_name"/></el-form-item><el-form-item label="计划日期"><el-date-picker v-model="msForm.planned_date" type="date" value-format="YYYY-MM-DD" style="width:100%"/></el-form-item><el-form-item label="收款%"><el-input-number v-model="msForm.payment_pct" :min="0" :max="100" style="width:100%"/></el-form-item><el-form-item label="收款金额"><el-input-number v-model="msForm.payment_amount" :min="0" style="width:100%"/></el-form-item></el-form><template #footer><el-button @click="showMSDlg=false">取消</el-button><el-button type="primary" @click="saveMS">保存</el-button></template></el-dialog>
      <!-- 收款弹窗 -->
      <el-dialog v-model="showPayDlg" title="记录收款" width="350px"><el-form :model="payForm" label-width="80px"><el-form-item label="金额"><el-input-number v-model="payForm.amount" :min="0" style="width:100%"/></el-form-item><el-form-item label="日期"><el-date-picker v-model="payForm.received_date" type="date" value-format="YYYY-MM-DD" style="width:100%"/></el-form-item><el-form-item label="方式"><el-input v-model="payForm.payment_method"/></el-form-item><el-form-item label="凭证号"><el-input v-model="payForm.voucher_no"/></el-form-item></el-form><template #footer><el-button @click="showPayDlg=false">取消</el-button><el-button type="primary" @click="savePay">保存</el-button></template></el-dialog>
    </el-tab-pane>

    <!-- ===== Tab 4: 客户验收 ===== -->
    <el-tab-pane label="客户验收" name="accept">
      <div class="tb"><el-select v-model="acf.inst" placeholder="装备实例" filterable @change="loadAC" style="width:280px"><el-option v-for="i in instances" :key="i.id" :label="i.instance_code+' '+ (i.instance_name||'')" :value="i.id"/></el-select>
        <el-button type="primary" @click="showACDlg=true">+ 新建检查表</el-button>
      </div>
      <el-table :data="achecklists" v-loading="acLoading" size="small" max-height="400" @row-click="showACDetail">
        <el-table-column prop="checklist_name" label="检查表" min-width="180"/><el-table-column prop="instance_code" label="实例" width="120"/>
        <el-table-column prop="inspector" label="检查人" width="80"/><el-table-column prop="customer_rep" label="客户代表" width="80"/>
        <el-table-column label="状态" width="80"><template #default="{r}"><el-tag :type="r.status==='signed'?'success':r.status==='in_progress'?'warning':'info'" size="small">{{{pending:'待检查',in_progress:'检查中',signed:'已签章'}[r.status]||r.status}}</el-tag></template></el-table-column>
        <el-table-column prop="sign_date" label="签章日期" width="100"/>
      </el-table>
      <!-- 检查表详情/执行 -->
      <el-dialog v-model="acDetail.show" :title="acDetail.data?.checklist_name" width="650px">
        <template v-if="acDetail.data">
          <div v-for="(item,i) in acDetail.items" :key="i" style="margin-bottom:8px">
            <el-checkbox v-model="item.checked" @change="saveACItems">{{item.label}}</el-checkbox>
            <el-input v-if="item.checked===false" v-model="item.note" placeholder="不合格说明" size="small" style="width:200px;margin-left:8px"/>
          </div>
          <div v-if="acDetail.debugTotal>0" style="margin-top:8px"><el-tag>累计调试工时: {{acDetail.debugTotal}}h</el-tag></div>
          <el-divider/>
          <el-form :inline="true"><el-form-item label="工时"><el-input-number v-model="debugH" :min="0" :step="0.5"/></el-form-item><el-form-item label="人员"><el-input v-model="debugW"/></el-form-item><el-form-item><el-button @click="addDebugHours">+ 记录调试工时</el-button></el-form-item></el-form>
          <el-form label-width="80px" style="margin-top:8px"><el-form-item label="检查人"><el-input v-model="acDetail.data.inspector"/></el-form-item><el-form-item label="客户代表"><el-input v-model="acDetail.data.customer_rep"/></el-form-item><el-form-item label="签章日期"><el-date-picker v-model="acDetail.data.sign_date" type="date" value-format="YYYY-MM-DD"/></el-form-item></el-form>
        </template>
        <template #footer><el-button @click="acDetail.show=false">取消</el-button><el-button type="primary" @click="signAC">签章确认</el-button></template>
      </el-dialog>
      <el-dialog v-model="showACDlg" title="新建检查表" width="400px"><el-form :model="acForm" label-width="80px"><el-form-item label="名称"><el-input v-model="acForm.checklist_name"/></el-form-item><el-form-item label="检查项(每行一项)"><el-input v-model="acForm.items_text" type="textarea" :rows="5" placeholder="外观检查&#10;电气测试&#10;液压测试"/></el-form-item><el-form-item label="检查人"><el-input v-model="acForm.inspector"/></el-form-item><el-form-item label="客户代表"><el-input v-model="acForm.customer_rep"/></el-form-item></el-form><template #footer><el-button @click="showACDlg=false">取消</el-button><el-button type="primary" @click="saveAC">创建</el-button></template></el-dialog>
    </el-tab-pane>

    <!-- ===== Tab 5: 故障知识库 ===== -->
    <el-tab-pane label="故障知识库" name="fault">
      <div class="tb"><el-select v-model="fktf.type" placeholder="装备类型" clearable @change="loadFK" style="width:160px"><el-option v-for="t in eqTypes" :key="t.id" :label="t.name_zh" :value="t.id"/></el-select>
        <el-select v-model="fktf.diff" placeholder="难度" clearable @change="loadFK" style="width:100px"><el-option label="简单" value="easy"/><el-option label="中等" value="medium"/><el-option label="困难" value="hard"/></el-select>
        <el-input v-model="fktf.kw" placeholder="搜索..." @keyup.enter="loadFK" style="width:160px" clearable/>
        <el-button type="primary" @click="loadFK">搜索</el-button><el-button @click="showFKDlg=true">+ 新增</el-button>
      </div>
      <el-table :data="faults" v-loading="fkLoading" size="small" max-height="400" @row-click="showFKDetail">
        <el-table-column prop="fault_code" label="故障码" width="100"/><el-table-column prop="fault_name" label="故障名称" min-width="160"/>
        <el-table-column prop="type_name" label="装备类型" width="100"/>
        <el-table-column label="难度" width="70"><template #default="{r}"><el-tag :type="r.difficulty==='hard'?'danger':r.difficulty==='medium'?'warning':'success'" size="small">{{{easy:'简单',medium:'中等',hard:'困难'}[r.difficulty]||r.difficulty}}</el-tag></template></el-table-column>
        <el-table-column label="频率" width="70"><template #default="{r}">{{{rare:'罕见',occasional:'偶发',frequent:'频发'}[r.frequency]||r.frequency}}</template></el-table-column>
        <el-table-column label="操作" width="100" align="center"><template #default="{r}"><el-button size="small" link type="primary" @click.stop="showFKDetail(r)">详情</el-button><el-button size="small" link type="danger" @click.stop="delFK(r)">删除</el-button></template></el-table-column>
      </el-table>
      <el-dialog v-model="fkDetail.show" :title="fkDetail.fault?.fault_name" width="650px">
        <template v-if="fkDetail.fault"><el-descriptions :column="2" border size="small"><el-descriptions-item label="故障码">{{fkDetail.fault.fault_code}}</el-descriptions-item><el-descriptions-item label="装备类型">{{fkDetail.fault.type_name||'-'}}</el-descriptions-item><el-descriptions-item label="难度">{{{easy:'简单',medium:'中等',hard:'困难'}[fkDetail.fault.difficulty]}}</el-descriptions-item><el-descriptions-item label="频率">{{{rare:'罕见',occasional:'偶发',frequent:'频发'}[fkDetail.fault.frequency]}}</el-descriptions-item><el-descriptions-item label="症状" :span="2">{{fkDetail.fault.symptom||'-'}}</el-descriptions-item><el-descriptions-item label="根本原因" :span="2">{{fkDetail.fault.root_cause||'-'}}</el-descriptions-item><el-descriptions-item label="解决方案" :span="2">{{fkDetail.fault.solution||'-'}}</el-descriptions-item></el-descriptions></template>
      </el-dialog>
      <el-dialog v-model="showFKDlg" title="新增故障知识" width="500px"><el-form :model="fkForm" label-width="80px"><el-form-item label="故障码"><el-input v-model="fkForm.fault_code"/></el-form-item><el-form-item label="故障名称"><el-input v-model="fkForm.fault_name"/></el-form-item><el-form-item label="装备类型"><el-select v-model="fkForm.equipment_type_id" clearable style="width:100%"><el-option v-for="t in eqTypes" :key="t.id" :label="t.name_zh" :value="t.id"/></el-select></el-form-item><el-form-item label="症状"><el-input v-model="fkForm.symptom" type="textarea" :rows="2"/></el-form-item><el-form-item label="根本原因"><el-input v-model="fkForm.root_cause" type="textarea" :rows="2"/></el-form-item><el-form-item label="解决方案"><el-input v-model="fkForm.solution" type="textarea" :rows="2"/></el-form-item><el-form-item label="难度"><el-select v-model="fkForm.difficulty" style="width:100%"><el-option label="简单" value="easy"/><el-option label="中等" value="medium"/><el-option label="困难" value="hard"/></el-select></el-form-item><el-form-item label="频率"><el-select v-model="fkForm.frequency" style="width:100%"><el-option label="罕见" value="rare"/><el-option label="偶发" value="occasional"/><el-option label="频发" value="frequent"/></el-select></el-form-item></el-form><template #footer><el-button @click="showFKDlg=false">取消</el-button><el-button type="primary" @click="saveFK">保存</el-button></template></el-dialog>
    </el-tab-pane>
  </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const route = useRoute()
const router = useRouter()
const tabNames = new Set(['critical', 'purchase', 'project', 'accept', 'fault'])
const routeTab = () => {
  const value = String(route.query.tab || '')
  return tabNames.has(value) ? value : 'critical'
}
const tab = ref(routeTab())
const today = new Date().toISOString().substring(0,10)
const instances = ref([])
const eqTypes = ref([])
onMounted(async () => { try { const [i,t] = await Promise.all([Api.instances(),Api.equipmentTypes()]); instances.value=Array.isArray(i)?i:(i.data||[]); eqTypes.value=Array.isArray(t)?t:(t.data||[]) } catch(_) { ElMessage.error('加载设备列表失败') } onTab(tab.value) })

// ===== Tab 1: 关键件 =====
const cparts = ref([]); const cpLoading = ref(false)
const cf = reactive({inst:null,risk:''})
const cpDetail = reactive({show:false,part:null,certs:[],logs:[]})
const showCertForm = ref(false); const showLogForm = ref(false)
const certF = reactive({cert_type:'material',cert_no:'',issued_by:'',issue_date:'',expiry_date:''})
const logF = reactive({log_date:today,inspector:'',location:'',content:'',status:'normal'})
const loadCP = async () => { cpLoading.value=true; try { const p={}; if(cf.inst)p.equipment_instance_id=cf.inst; if(cf.risk)p.risk_level=cf.risk; cparts.value=await Api.get('/critical-parts',{params:p}) } catch(_){ cparts.value=[]; ElMessage.error('加载关键件失败') } finally {cpLoading.value=false} }
const showCPDetail = async (r) => { cpDetail.part=r; cpDetail.show=true; try { const d=await Api.get('/critical-parts/'+r.id); Object.assign(cpDetail,{part:d,certs:d.certificates||[],logs:d.logs||[]}) } catch(_) { ElMessage.error('加载关键件详情失败') } }
const saveCert = async () => { await Api.post('/critical-parts/'+cpDetail.part.id+'/certificates',certF); ElMessage.success('证书已添加'); showCertForm.value=false; showCPDetail(cpDetail.part) }
const delCert = async (r) => { await Api.del('/critical-parts/'+cpDetail.part.id+'/certificates/'+r.id); ElMessage.success('已删除'); showCPDetail(cpDetail.part) }
const saveLog = async () => { await Api.post('/supervision-logs',{...logF,part_id:cpDetail.part.id}); ElMessage.success('日志已添加'); showLogForm.value=false; showCPDetail(cpDetail.part) }

// ===== Tab 2: 采购跟催 =====
const ptracks = ref([]); const ptLoading = ref(false)
const ptf = reactive({status:'',overdue:false}); const showPTDlg = ref(false)
const ptForm = reactive({item_name:'',supplier:'',planned_delivery:'',remarks:''})
const ptStats = computed(()=>{const p=ptracks.value;return[{l:'总计',v:p.length,s:'项',t:'info'},{l:'逾期',v:p.filter(x=>x.delay_days>0&&x.status!=='delivered').length,s:'项',t:'danger'},{l:'待交货',v:p.filter(x=>x.status==='pending').length,s:'项',t:'warning'},{l:'已交货',v:p.filter(x=>x.status==='delivered').length,s:'项',t:'success'}]})

const loadPT = async () => { ptLoading.value=true; try { const p={}; if(ptf.status)p.status=ptf.status; if(ptf.overdue)p.overdue='1'; ptracks.value=await Api.get('/purchase-tracking',{params:p}) } catch(_){ ptracks.value=[]; ElMessage.error('加载采购跟踪失败') } finally {ptLoading.value=false} }
const savePT = async () => { await Api.post('/purchase-tracking',ptForm); ElMessage.success('已添加'); showPTDlg.value=false; Object.assign(ptForm,{item_name:'',supplier:'',planned_delivery:'',remarks:''}); loadPT() }
const markDelivered = async (r) => { await Api.put('/purchase-tracking/'+r.id,{status:'delivered',actual_delivery:today}); ElMessage.success('已标记交货'); loadPT() }

// ===== Tab 3: 项目看板 =====
const prj = reactive({inst:null,summary:null,milestones:[]})
const showMSDlg = ref(false); const showPayDlg = ref(false)
const msForm = reactive({milestone_name:'',planned_date:'',payment_pct:0,payment_amount:0,editing_id:null})
const payForm = reactive({amount:0,received_date:today,payment_method:'',voucher_no:'',milestone_id:null})
const loadProject = async () => { if(!prj.inst)return; try { prj.summary=await Api.get('/project-summary/'+prj.inst); prj.milestones=await Api.get('/contract-milestones',{params:{equipment_instance_id:prj.inst}}) } catch(_) { ElMessage.error('加载项目数据失败') } }
const autoGenMile = async () => { if(!prj.inst)return; await Api.post('/equipment_instances/'+prj.inst+'/milestones/auto-generate'); ElMessage.success('S1-S10 已生成'); loadProject() }
const openMilestoneEdit = (r) => { Object.assign(msForm,{milestone_name:r.milestone_name,planned_date:r.planned_date,payment_pct:r.payment_pct,payment_amount:r.payment_amount,editing_id:r.id}); showMSDlg.value=true }
const saveMS = async () => {
  if(msForm.editing_id) await Api.put('/contract-milestones/'+msForm.editing_id,msForm)
  else await Api.post('/contract-milestones',{...msForm,equipment_instance_id:prj.inst,sequence:prj.milestones.length+1})
  ElMessage.success('已保存'); showMSDlg.value=false; loadProject()
}
const openPayment = (r) => { payForm.milestone_id=r.id; showPayDlg.value=true }
const savePay = async () => { await Api.post('/project-payments',{...payForm,equipment_instance_id:prj.inst}); ElMessage.success('收款已记录'); showPayDlg.value=false; loadProject() }

// ===== Tab 4: 客户验收 =====
const achecklists = ref([]); const acLoading = ref(false)
const acf = reactive({inst:null}); const showACDlg = ref(false)
const acForm = reactive({checklist_name:'',items_text:'',inspector:'',customer_rep:''})
const acDetail = reactive({show:false,data:null,items:[],debugTotal:0})
const debugH = ref(0); const debugW = ref('')
const loadAC = async () => { acLoading.value=true; try { const p={}; if(acf.inst)p.equipment_instance_id=acf.inst; achecklists.value=await Api.get('/acceptance-checklists',{params:p}) } catch(_){ achecklists.value=[]; ElMessage.error('加载验收清单失败') } finally {acLoading.value=false} }
const saveAC = async () => {
  const items = acForm.items_text.split('\\n').filter(l=>l.trim()).map(l=>({label:l.trim(),checked:false,note:''}))
  await Api.post('/acceptance-checklists',{equipment_instance_id:acf.inst,checklist_name:acForm.checklist_name,items,inspector:acForm.inspector,customer_rep:acForm.customer_rep})
  ElMessage.success('已创建'); showACDlg.value=false; Object.assign(acForm,{checklist_name:'',items_text:'',inspector:'',customer_rep:''}); loadAC()
}
const showACDetail = async (r) => {
  try { const d=await Api.get('/acceptance-checklists/'+r.id); acDetail.data=r; acDetail.items=d.items_parsed||[]; acDetail.debugTotal=acDetail.items.find(i=>i.type==='debug_hours')?.records?.reduce((s,x)=>s+(x.hours||0),0)||0; acDetail.show=true } catch(_) { ElMessage.error('加载验收详情失败') }
}
const saveACItems = async () => { await Api.put('/acceptance-checklists/'+acDetail.data.id,{items:acDetail.items}) }
const addDebugHours = async () => {
  await Api.post('/acceptance-checklists/'+acDetail.data.id+'/debug-hours',{hours:debugH.value,worker:debugW.value,date:today,notes:''})
  ElMessage.success('已记录'); debugH.value=0; debugW.value=''; showACDetail(acDetail.data)
}
const signAC = async () => {
  const allChecked = acDetail.items.filter(i=>i.type!=='debug_hours').every(i=>i.checked)
  const result = allChecked?'pass':'fail'
  await Api.put('/acceptance-checklists/'+acDetail.data.id,{...acDetail.data,items:acDetail.items,status:'signed',result,sign_date:acDetail.data.sign_date||today})
  ElMessage.success('已签章'); acDetail.show=false; loadAC()
}

// ===== Tab 5: 故障知识库 =====
const faults = ref([]); const fkLoading = ref(false)
const fktf = reactive({type:null,diff:'',kw:''})
const showFKDlg = ref(false); const fkDetail = reactive({show:false,fault:null})
const fkForm = reactive({equipment_type_id:null,fault_code:'',fault_name:'',symptom:'',root_cause:'',solution:'',difficulty:'medium',frequency:'occasional'})
const loadFK = async () => { fkLoading.value=true; try { const p={}; if(fktf.type)p.equipment_type_id=fktf.type; if(fktf.diff)p.difficulty=fktf.diff; if(fktf.kw)p.keyword=fktf.kw; faults.value=await Api.get('/fault-knowledge',{params:p}) } catch(_){ faults.value=[]; ElMessage.error('加载故障知识库失败') } finally {fkLoading.value=false} }
const showFKDetail = (r) => { fkDetail.fault=r; fkDetail.show=true }
const saveFK = async () => { await Api.post('/fault-knowledge',fkForm); ElMessage.success('已添加'); showFKDlg.value=false; Object.assign(fkForm,{equipment_type_id:null,fault_code:'',fault_name:'',symptom:'',root_cause:'',solution:'',difficulty:'medium',frequency:'occasional'}); loadFK() }
const delFK = async (r) => { try { await ElMessageBox.confirm('删除 '+r.fault_name+'?','确认',{type:'warning'}); await Api.del('/fault-knowledge/'+r.id); ElMessage.success('已删除'); loadFK() } catch(_) { if (_ !== 'cancel' && _ !== 'close') ElMessage.error('删除失败') } }

const onTab = (t) => {
  if (route.query.tab !== t) router.replace({ query: { ...route.query, tab: t } })
  if(t==='critical'&&cparts.value.length===0)loadCP()
  if(t==='purchase'&&ptracks.value.length===0)loadPT()
  if(t==='accept'&&achecklists.value.length===0)loadAC()
  if(t==='fault'&&faults.value.length===0)loadFK()
}
watch(() => route.query.tab, () => {
  const next = routeTab()
  if (next !== tab.value) {
    tab.value = next
    onTab(next)
  }
})
</script>

<style scoped>.page{padding:16px 24px}.page-header{margin-bottom:16px}.page-title{font-size:20px;font-weight:600}.tb{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}</style>
