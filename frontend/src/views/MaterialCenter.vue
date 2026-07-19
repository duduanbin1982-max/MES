<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title"><el-icon><Box /></el-icon> 物料中心</div>
      <el-button @click="refresh">刷新</el-button>
    </div>
    <el-alert v-if="data.alerts.value.length" type="error" :closable="false" style="margin-bottom: 12px" show-icon>
      <el-icon><Warning /></el-icon> {{ data.alerts.value.length }} 项物料低于安全库存: {{ data.alerts.value.slice(0, 3).map(a => a.material_code).join('、') }}{{ data.alerts.value.length > 3 ? ` 等 ${data.alerts.value.length} 项` : '' }}
    </el-alert>

    <el-tabs v-model="activeTab" type="border-card">
      <el-tab-pane name="materials"><template #label><span><el-icon><Document /></el-icon> 物料主数据</span></template>
        <TabMaterials v-if="activeTab === 'materials'" :tab="activeTab" />
      </el-tab-pane>
      <el-tab-pane name="key"><template #label><span>⭐ 关键外购件</span></template>
        <TabKey v-if="activeTab === 'key'" :tab="activeTab" />
      </el-tab-pane>
      <el-tab-pane name="long"><template #label><span><el-icon><Warning /></el-icon> 长交期预警 (≥12 周)</span></template>
        <TabLong v-if="activeTab === 'long'" :tab="activeTab" />
      </el-tab-pane>
      <el-tab-pane name="inv">
        <template #label>
          <span><el-icon><Files(orCoin) /></el-icon> 库存清单</span>
          <el-badge v-if="data.alerts.value.length" :value="data.alerts.value.length" type="danger" :max="99" style="margin-left: 6px" />
        </template>
        <TabInv v-if="activeTab === 'inv' || activeTab === 'mov' || activeTab === 'ops'" :inv="data.inv.value" @open-receive="dlgReceive = true" @open-allocate="dlgAllocate = true" @open-release="dlgRelease = true" @open-batch="dlgBatch = true" @open-detail="onDetail" @open-split="onSplit" @open-merge="onMerge" />
      </el-tab-pane>
      <el-tab-pane :name="'mov'">
        <template #label><span><el-icon><DataAnalysis /></el-icon> 移动记录{{ data.movTotal.value > 0 ? ` (${data.movTotal.value})` : '' }}</span></template>
        <TabMov v-if="activeTab === 'mov'" :tab="activeTab" />
      </el-tab-pane>
      <el-tab-pane name="ops"><template #label><span><el-icon><Edit /></el-icon> 操作</span></template>
        <TabOps v-if="activeTab === 'ops'" :tab="activeTab" @refresh="refresh" />
      </el-tab-pane>
      <el-tab-pane name="import"><template #label><span><el-icon><Download /></el-icon> 导入校验</span></template>
        <TabImport v-if="activeTab === 'import'" :tab="activeTab" />
      </el-tab-pane>
      <el-tab-pane name="units"><template #label><span>单位换算</span></template>
        <TabUnits v-if="activeTab === 'units'" :tab="activeTab" />
      </el-tab-pane>
    </el-tabs>

    <!-- Dialogs (动态 import) -->
    <DlgReceive v-if="dlgReceive" v-model="dlgReceive" :materials="data.materials.value" @done="refresh" />
    <DlgAllocRelease v-if="dlgAllocate || dlgRelease" v-model:modelValueAllocate="dlgAllocate" v-model:modelValueRelease="dlgRelease" :lots="data.lots.value" @done="refresh" />
    <DlgSplitMerge v-if="dlgSplit || dlgMerge" ref="splitMergeRef" v-model:modelValueSplit="dlgSplit" v-model:modelValueMerge="dlgMerge" :inv="data.inv.value" @done="refresh" />
    <DlgBatch v-if="dlgBatch" v-model="dlgBatch" :lots="data.lots.value" :mov-type-options="data.movTypeOptions" @done="refresh" />
    <DlgLotDetail v-if="dlgDetail" v-model="dlgDetail" :lot-id="currentLotId" :mov-type-label="data.movTypeLabel" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useInvData } from './materialCenter/useInvData'

// 动态 import 6 tab + 5 dialog (按需加载, 首屏不下载)
const TabMaterials = defineAsyncComponent(() => import('./materialCenter/TabMaterials.vue'))
const TabKey      = defineAsyncComponent(() => import('./materialCenter/TabKey.vue'))
const TabLong     = defineAsyncComponent(() => import('./materialCenter/TabLong.vue'))
const TabInv      = defineAsyncComponent(() => import('./materialCenter/TabInv.vue'))
const TabMov      = defineAsyncComponent(() => import('./materialCenter/TabMov.vue'))
const TabOps      = defineAsyncComponent(() => import('./materialCenter/TabOps.vue'))
const TabImport   = defineAsyncComponent(() => import('./materialCenter/TabImport.vue'))
const TabUnits    = defineAsyncComponent(() => import('./materialCenter/TabUnits.vue'))
const DlgReceive      = defineAsyncComponent(() => import('./materialCenter/DlgReceive.vue'))
const DlgAllocRelease = defineAsyncComponent(() => import('./materialCenter/DlgAllocRelease.vue'))
const DlgSplitMerge   = defineAsyncComponent(() => import('./materialCenter/DlgSplitMerge.vue'))
const DlgBatch        = defineAsyncComponent(() => import('./materialCenter/DlgBatch.vue'))
const DlgLotDetail    = defineAsyncComponent(() => import('./materialCenter/DlgLotDetail.vue'))

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const data = useInvData()

// 默认 tab 按角色预设
const TAB_BY_ROLE: Record<string, string> = {
  admin: 'materials', foreman: 'materials', planner: 'materials', engineer: 'materials',
  warehouse: 'inv', viewer: 'materials', welder: 'ops',
}
const activeTab = ref<string>((route.query.tab as string) || TAB_BY_ROLE[auth.user?.role || ''] || 'materials')
watch(() => route.query.tab, (v) => { if (v && typeof v === 'string' && v !== activeTab.value) activeTab.value = v })
watch(activeTab, (v) => { if (route.query.tab !== v) router.replace({ query: { ...route.query, tab: v } }) })

// Dialogs
const dlgReceive = ref(false)
const dlgAllocate = ref(false)
const dlgRelease = ref(false)
const dlgSplit = ref(false)
const dlgMerge = ref(false)
const dlgBatch = ref(false)
const dlgDetail = ref(false)
const currentLotId = ref<number | null>(null)
const splitMergeRef = ref<any>(null)

const onDetail = (row: any) => { currentLotId.value = row.material_lot_id; dlgDetail.value = true }
const onSplit = (row: any) => { splitMergeRef.value?.openSplit(row) }
const onMerge = (row: any) => { splitMergeRef.value?.openMerge(row) }

const refresh = async () => { await data.loadInvOnly() }

onMounted(async () => { await data.loadAll() })
</script>

<style scoped>
.page { padding: 16px }
.page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px }
.page-title { font-size: 18px; font-weight: 600; margin-right: auto }
</style>
