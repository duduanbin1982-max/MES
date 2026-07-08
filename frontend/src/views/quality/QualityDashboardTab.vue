<template>
  <div>
    <el-row :gutter="12" class="dashboard-row">
      <el-col :span="6"><el-card shadow="never"><el-statistic title="30天合格率" :value="`${dash.pass_rate_30d || 0}%`" /></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><el-statistic title="未关闭NCR" :value="dash.ncr_open || 0"><template #suffix><span class="danger-suffix">个</span></template></el-statistic></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><el-statistic title="CAPA开放" :value="dash.capa_open || 0" /></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><el-statistic title="CAPA逾期" :value="dash.capa_overdue || 0"><template #suffix><span class="warning-suffix">⚠</span></template></el-statistic></el-card></el-col>
    </el-row>

    <el-row :gutter="12">
      <el-col :span="12">
        <el-card shadow="never" header="Top5 缺陷 (Pareto)">
          <el-table :data="dash.defect_top5 || []" size="small" max-height="260" empty-text="暂无缺陷记录">
            <el-table-column type="index" label="#" width="40" />
            <el-table-column prop="defect_type" label="缺陷类型" min-width="160" />
            <el-table-column prop="count" label="数量" width="80">
              <template #default="{row}"><el-tag size="small" type="danger">{{ row.count }}</el-tag></template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never" header="SPC 实时监控">
          <el-table :data="spcDash.recent_alerts || []" size="small" max-height="260" empty-text="暂无SPC报警">
            <el-table-column prop="node_name" label="工序" width="100" />
            <el-table-column prop="param" label="参数" width="100" />
            <el-table-column prop="rule_desc" label="规则" min-width="140" />
            <el-table-column prop="created_at" label="时间" width="100" />
          </el-table>
          <div class="spc-summary">
            监控节点: {{ spcDash.monitored_nodes_24h || 0 }} | 未确认报警:
            <span :style="{color:(spcDash.unacknowledged || 0)>0?'#f56c6c':'#67c23a'}">{{ spcDash.unacknowledged || 0 }}</span>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  dash: any
  spcDash: any
}>()
</script>

<style scoped>
.dashboard-row{margin-bottom:12px}
.danger-suffix{color:#f56c6c;font-size:14px}
.warning-suffix{color:#e6a23c;font-size:14px}
.spc-summary{margin-top:8px;color:#909399;font-size:12px}
</style>
