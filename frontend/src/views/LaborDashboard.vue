<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div class="page-title"><el-icon><UserFilled /></el-icon> 劳动力管理 (资质·技能·工时)</div>
      <el-button @click="refresh" :icon="Refresh" :loading="loading">刷新</el-button>
    </PageToolbar>

    <!-- 统计卡片 -->
    <el-row :gutter="12" style="margin-bottom:12px">
      <el-col :span="4"><el-card shadow="never"><el-statistic title="在册工人" :value="dash.workers?.length || 0" /></el-card></el-col>
      <el-col :span="5"><el-card shadow="never"><el-statistic title="证书临期(30天)" :value="dash.expiring_certs?.length || 0"><template #suffix><span style="color:var(--el-color-warning);font-size:14px"><el-icon><Warning /></el-icon></span></template></el-statistic></el-card></el-col>
      <el-col :span="5"><el-card shadow="never"><el-statistic title="技能项数" :value="totalSkills" /></el-card></el-col>
      <el-col :span="5"><el-card shadow="never"><el-statistic title="培训通过率" :value="dash.training?.rate + '%' || '—'" /></el-card></el-col>
      <el-col :span="5"><el-card shadow="never"><el-statistic title="本周工时Top1" :value="topWorkerName" /></el-card></el-col>
    </el-row>

    <el-tabs v-model="activeTab" type="border-card">
      <!-- Tab 1: 工人列表 -->
      <el-tab-pane name="workers">
        <template #label><span class="tab-label"><el-icon><User /></el-icon>工人名录</span></template>
        <el-table :data="dash.workers" size="small" max-height="400">
          <el-table-column prop="full_name" label="姓名" width="100" />
          <el-table-column prop="role_code" label="角色" width="80">
            <template #default="{row}"><el-tag size="small">{{ row.role_code }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="workstation_name" label="工位" width="120" />
          <el-table-column prop="skills" label="技能" min-width="200">
            <template #default="{row}">
              <el-tag v-for="s in (row.skills||'').split(',').filter(Boolean)" :key="s" size="small" type="info" style="margin:1px">{{ s.trim() }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="availability" label="状态" width="80">
            <template #default="{row}"><el-tag :type="row.availability==='online'?'success':'info'" size="small">{{ row.availability }}</el-tag></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Tab 2: 证书 -->
      <el-tab-pane name="certs">
        <template #label><span class="tab-label"><el-icon><Memo /></el-icon>资质证书</span></template>
        <div style="margin-bottom:8px">
          <el-button size="small" type="primary" @click="showAddCert=true">添加证书</el-button>
          <el-checkbox v-model="showExpiringOnly" style="margin-left:12px">仅看临期</el-checkbox>
        </div>
        <el-table :data="filteredCerts" size="small" max-height="380">
          <el-table-column prop="full_name" label="姓名" width="80" />
          <el-table-column prop="cert_name" label="证书名称" min-width="160" />
          <el-table-column prop="cert_number" label="编号" width="150" />
          <el-table-column prop="cert_level" label="等级" width="60" />
          <el-table-column prop="expiry_date" label="到期日" width="100">
            <template #default="{row}">
              <span :style="{color: isExpiringSoon(row.expiry_date)?'var(--el-color-danger)':''}">{{ row.expiry_date || '永久' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="70">
            <template #default="{row}"><el-tag :type="row.status==='valid'?'success':'danger'" size="small">{{ row.status==='valid'?'有效':'失效' }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{row}">
              <el-button size="small" link type="danger" @click="deleteCert(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Tab 3: 技能矩阵 -->
      <el-tab-pane name="skills">
        <template #label><span class="tab-label"><el-icon><Aim /></el-icon>技能矩阵</span></template>
        <div style="margin-bottom:8px">
          <el-select v-model="skillCategory" placeholder="技能分类" clearable size="small" style="width:160px">
            <el-option v-for="c in skillCategories" :key="c" :label="c" :value="c" />
          </el-select>
          <el-button size="small" type="primary" @click="showAddSkill=true" style="margin-left:8px">添加技能</el-button>
        </div>
        <el-table :data="filteredSkills" size="small" max-height="400">
          <el-table-column prop="full_name" label="姓名" width="80" />
          <el-table-column prop="skill_name" label="技能" min-width="140" />
          <el-table-column prop="skill_category" label="分类" width="90" />
          <el-table-column label="等级" width="120">
            <template #default="{row}">
              <el-rate :model-value="row.proficiency_level" :max="5" disabled show-score text-color="#ff9900" />
            </template>
          </el-table-column>
          <el-table-column prop="years_experience" label="年限" width="60" />
          <el-table-column label="持证" width="60">
            <template #default="{row}"><span :style="{color:row.certified?'var(--el-color-success)':'var(--el-color-info)'}"><template v-if="row.certified"><el-icon><CircleCheck /></el-icon></template><template v-else>—</template></span></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Tab 4: 培训记录 -->
      <el-tab-pane name="training">
        <template #label><span class="tab-label"><el-icon><Reading /></el-icon>培训记录</span></template>
        <el-table :data="trainings" size="small" max-height="400" @row-click="(r:any)=>{}">
          <el-table-column prop="full_name" label="姓名" width="80" />
          <el-table-column prop="training_name" label="培训名称" min-width="180" />
          <el-table-column prop="training_type" label="类型" width="80">
            <template #default="{row}"><el-tag size="small" :type="row.training_type==='external'?'warning':''">{{ row.training_type==='external'?'外部':'内部' }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="provider" label="机构" width="140" />
          <el-table-column prop="start_date" label="日期" width="100" />
          <el-table-column prop="duration_hours" label="学时" width="60" />
          <el-table-column prop="score" label="成绩" width="60" />
          <el-table-column label="通过" width="60">
            <template #default="{row}"><el-tag :type="row.passed?'success':'danger'" size="small">{{ row.passed?'通过':'未过' }}</el-tag></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Tab 5: 工时Top -->
      <el-tab-pane label="⏱️ 工时排行" name="hours">
        <el-table :data="dash.top_workers" size="small" max-height="400">
          <el-table-column type="index" label="#" width="40" />
          <el-table-column prop="full_name" label="姓名" width="100" />
          <el-table-column prop="tasks" label="任务数" width="80" />
          <el-table-column prop="total_hours" label="总工时(h)" width="100" />
        </el-table>
        <PageState state="empty" compact :show-action="false" v-if="!dash.top_workers?.length" description="本周暂无工时记录" />
      </el-tab-pane>
    </el-tabs>

    <!-- 添加证书对话框 -->
    <el-dialog v-model="showAddCert" title="添加证书" width="500px">
      <el-form :model="certForm" label-width="80px" size="small">
        <el-form-item label="工人"><el-select v-model="certForm.user_id" filterable><el-option v-for="w in dash.workers" :key="w.id" :label="w.full_name" :value="w.id" /></el-select></el-form-item>
        <el-form-item label="证书类型"><el-input v-model="certForm.cert_type" placeholder="如 welding/ndt/safety" /></el-form-item>
        <el-form-item label="证书名称"><el-input v-model="certForm.cert_name" placeholder="如 焊工特种作业操作证" /></el-form-item>
        <el-form-item label="编号"><el-input v-model="certForm.cert_number" /></el-form-item>
        <el-form-item label="发证机构"><el-input v-model="certForm.issuing_authority" /></el-form-item>
        <el-form-item label="发证日期"><el-date-picker v-model="certForm.issued_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="到期日期"><el-date-picker v-model="certForm.expiry_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="等级"><el-input v-model="certForm.cert_level" placeholder="如 Ⅱ级" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="showAddCert=false">取消</el-button><el-button type="primary" @click="submitCert">提交</el-button></template>
    </el-dialog>

    <!-- 添加技能对话框 -->
    <el-dialog v-model="showAddSkill" title="添加技能" width="450px">
      <el-form :model="skillForm" label-width="80px" size="small">
        <el-form-item label="工人"><el-select v-model="skillForm.user_id" filterable><el-option v-for="w in dash.workers" :key="w.id" :label="w.full_name" :value="w.id" /></el-select></el-form-item>
        <el-form-item label="技能名称"><el-input v-model="skillForm.skill_name" placeholder="如 手工电弧焊" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="skillForm.skill_category" placeholder="如 welding/cad/ndt" /></el-form-item>
        <el-form-item label="等级"><el-rate v-model="skillForm.proficiency_level" :max="5" show-score /></el-form-item>
        <el-form-item label="年限"><el-input-number v-model="skillForm.years_experience" :min="0" :max="50" :step="0.5" /></el-form-item>
        <el-form-item label="持证"><el-switch v-model="skillForm.certified" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="showAddSkill=false">取消</el-button><el-button type="primary" @click="submitSkill">提交</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const loading = ref(false)
const activeTab = ref('workers')
const dash = ref<any>({ workers: [], expiring_certs: [], skill_stats: [], top_workers: [], training: {} })
const allCerts = ref<any[]>([])
const allSkills = ref<any[]>([])
const trainings = ref<any[]>([])
const showExpiringOnly = ref(false)
const skillCategory = ref('')
const showAddCert = ref(false)
const showAddSkill = ref(false)

const certForm = reactive({ user_id: null, cert_type: '', cert_name: '', cert_number: '', issuing_authority: '', issued_date: '', expiry_date: '', cert_level: '' })
const skillForm = reactive({ user_id: null, skill_name: '', skill_category: '', proficiency_level: 3, years_experience: 1, certified: false })

const totalSkills = computed(() => allSkills.value.length)
const topWorkerName = computed(() => dash.value.top_workers?.[0]?.full_name || '—')
const skillCategories = computed(() => [...new Set(allSkills.value.map((s:any) => s.skill_category))])

const filteredCerts = computed(() => showExpiringOnly.value ? dash.value.expiring_certs || [] : allCerts.value)
const filteredSkills = computed(() => skillCategory.value ? allSkills.value.filter((s:any) => s.skill_category === skillCategory.value) : allSkills.value)

function isExpiringSoon(date: string) {
  if (!date) return false
  const d = new Date(date)
  const now = new Date()
  const days = Math.ceil((d.getTime() - now.getTime()) / 86400000)
  return days >= 0 && days <= 30
}

async function refresh() {
  loading.value = true
  try {
    const [d, c, s, t] = await Promise.all([
      api.get('/labor/dashboard'),
      api.get('/labor/certificates'),
      api.get('/labor/skills'),
      api.get('/labor/training'),
    ])
    dash.value = d
    allCerts.value = c
    allSkills.value = s
    trainings.value = t
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e?.message || e))
  } finally { loading.value = false }
}

async function submitCert() {
  try {
    await api.post('/labor/certificates', certForm)
    ElMessage.success('证书添加成功')
    showAddCert.value = false
    Object.assign(certForm, { user_id: null, cert_type: '', cert_name: '', cert_number: '', issuing_authority: '', issued_date: '', expiry_date: '', cert_level: '' })
    refresh()
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || e.message) }
}

async function deleteCert(id: number) {
  try { await api.delete('/labor/certificates/' + id); ElMessage.success('已删除'); refresh() } catch (e: any) { ElMessage.error(e.message) }
}

async function submitSkill() {
  try {
    await api.post('/labor/skills', skillForm)
    ElMessage.success('技能添加成功')
    showAddSkill.value = false
    Object.assign(skillForm, { user_id: null, skill_name: '', skill_category: '', proficiency_level: 3, years_experience: 1, certified: false })
    refresh()
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || e.message) }
}

onMounted(refresh)
</script>

<style scoped>
.page { padding: 16px; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.page-title { font-size: 18px; font-weight: 600; }
.tab-label { display: inline-flex; align-items: center; gap: 6px; }
</style>
