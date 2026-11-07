<template>
  <el-drawer v-model="visible" size="70%" :title="data?.project?.instance_code ? `${data.project.instance_code} 主线数据体检` : '主线数据体检'">
    <template v-if="data">
      <el-row :gutter="12" class="lineage-kpis">
        <el-col :span="6"><el-card shadow="never"><div class="stat-label">主线健康分</div><div class="stat-value" :class="{ danger: data.level === 'critical' || data.level === 'high', warning: data.level === 'warning' }">{{ data.score }}</div></el-card></el-col>
        <el-col :span="6"><el-card shadow="never"><div class="stat-label">缺口总数</div><div class="stat-value warning">{{ data.summary?.gap_count || 0 }}</div></el-card></el-col>
        <el-col :span="6"><el-card shadow="never"><div class="stat-label">高危缺口</div><div class="stat-value danger">{{ data.summary?.severe_gap_count || 0 }}</div></el-card></el-col>
        <el-col :span="6"><el-card shadow="never"><div class="stat-label">主线关键字段</div><div class="lineage-keys">{{ data.link_keys?.join(' / ') }}</div></el-card></el-col>
      </el-row>

      <el-alert class="lineage-alert" type="info" :closable="false" show-icon title="主线体检用于确认一台 TBM 的合同、BOM、图纸、采购、齐套、工单、报工、质检、成本、批次和验收是否能串成完整数据链。" />

      <el-tabs v-model="activeTab">
        <el-tab-pane label="链路阶段" name="segments">
          <el-table :data="data.segments || []" size="small" height="380">
            <el-table-column prop="label" label="阶段" width="120" />
            <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="lineageStatusTag(row.status)" size="small">{{ lineageStatusLabel(row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="完整度" width="190"><template #default="{ row }"><el-progress :percentage="row.percent || 0" :stroke-width="8" /></template></el-table-column>
            <el-table-column prop="linked" label="已关联" width="90" />
            <el-table-column prop="total" label="总量" width="90" />
            <el-table-column prop="gap_count" label="缺口" width="90" />
            <el-table-column prop="owner_role" label="责任角色" width="130" />
            <el-table-column label="处理入口" width="160"><template #default="{ row }"><div class="fix-entry"><el-tag size="small" type="info">{{ fixEntry(row).module || '业务模块' }}</el-tag><span>{{ fixEntry(row).label || '进入处理' }}</span></div></template></el-table-column>
            <el-table-column label="操作" width="110"><template #default="{ row }"><el-button link type="primary" size="small" @click="emit('open-entry', row)">一键处理</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="数据缺口" name="gaps">
          <el-table :data="data.gaps || []" size="small" height="420" empty-text="主线数据链暂无明显缺口">
            <el-table-column label="级别" width="80"><template #default="{ row }"><el-tag :type="severityTag(row.severity)" size="small">{{ severityLabel(row.severity) }}</el-tag></template></el-table-column>
            <el-table-column prop="title" label="缺口" min-width="180" show-overflow-tooltip />
            <el-table-column prop="message" label="影响说明" min-width="320" show-overflow-tooltip />
            <el-table-column prop="count" label="数量" width="80" />
            <el-table-column prop="owner_role" label="责任角色" width="120" />
            <el-table-column label="样例" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ (row.samples || []).join('，') || '-' }}</template></el-table-column>
            <el-table-column label="修复入口" width="180"><template #default="{ row }"><div class="fix-entry"><el-tag size="small" type="info">{{ fixEntry(row).module || '业务模块' }}</el-tag><span>{{ fixEntry(row).label || '进入处理' }}</span></div></template></el-table-column>
            <el-table-column label="清单" width="80">
              <template #default="{ row }">
                <el-popover placement="left" width="260" trigger="click">
                  <template #reference><el-button link size="small">查看</el-button></template>
                  <div class="fix-checklist-title">{{ row.title }}</div>
                  <ol class="fix-checklist"><li v-for="item in fixEntry(row).checklist || []" :key="item">{{ item }}</li></ol>
                  <PageState state="empty" compact :show-action="false" v-if="!(fixEntry(row).checklist || []).length" description="暂无处理清单" />
                </el-popover>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="110"><template #default="{ row }"><el-button link type="primary" size="small" @click="emit('open-entry', row)">一键处理</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </template>
    <el-skeleton v-else :rows="8" animated />
  </el-drawer>
</template>

<script setup lang="ts">
import { fixEntry, lineageStatusLabel, lineageStatusTag, severityLabel, severityTag } from './deliveryShared'

defineProps<{ data: any | null }>()
const visible = defineModel<boolean>({ required: true })
const activeTab = defineModel<string>('activeTab', { required: true })
const emit = defineEmits<{ 'open-entry': [row: any] }>()
</script>

<style scoped>
.lineage-kpis { margin-bottom: 12px; }
.lineage-alert { margin-bottom: 12px; }
.lineage-keys { margin-top: 10px; color: var(--el-text-color-regular); font-size: 13px; line-height: 1.5; }
.stat-label { color: var(--el-text-color-secondary); font-size: 13px; }
.stat-value { font-size: 30px; font-weight: 700; margin-top: 10px; }
.stat-value.danger { color: var(--el-color-danger); }
.stat-value.warning { color: var(--el-color-warning); }
.fix-entry { display: flex; align-items: center; gap: 6px; min-width: 0; }
.fix-entry span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fix-checklist-title { font-weight: 600; margin-bottom: 8px; color: var(--el-text-color-primary); }
.fix-checklist { margin: 0; padding-left: 18px; color: var(--el-text-color-regular); line-height: 1.8; }
</style>
