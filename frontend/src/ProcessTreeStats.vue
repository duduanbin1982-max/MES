<template>
  <div>
    <!-- 进度统计 -->
    <el-row :gutter="16" style="margin-bottom: 16px">
      <el-col :span="5"><div class="stat-card" style="text-align: center"><div class="stat-label">总节点</div><div class="stat-value">{{ progress.total_nodes || 0 }}</div></div></el-col>
      <el-col :span="5"><div class="stat-card" style="text-align: center"><div class="stat-label">已完成</div><div class="stat-value" style="color: #67c23a">{{ progress.completed_nodes || 0 }} ({{ progress.progress_pct || 0 }}%)</div></div></el-col>
      <el-col :span="5"><div class="stat-card" style="text-align: center"><div class="stat-label">进行中</div><div class="stat-value" style="color: #409eff">{{ progress.by_status?.in_progress || 0 }}</div></div></el-col>
      <el-col :span="5"><div class="stat-card" style="text-align: center"><div class="stat-label">可开始</div><div class="stat-value" style="color: #e6a23c">{{ progress.by_status?.ready || 0 }}</div></div></el-col>
      <el-col :span="4"><div class="stat-card" style="text-align: center"><div class="stat-label">卡住</div><div class="stat-value" style="color: #f56c6c">{{ progress.by_status?.blocked || 0 }}</div></div></el-col>
    </el-row>

    <!-- CPM 关键路径 -->
    <el-row :gutter="16" style="margin-bottom: 16px">
      <el-col :span="12"><el-card><div class="stat-label">总工期 (含物料交期)</div><div class="stat-value" style="font-size: 24px">{{ formatWeeks(cpm.total_weeks) }} 周 <span style="font-size: 14px; color: #909399">({{ cpm.total_days || 0 }} 天 / {{ cpm.total_hours || 0 }}h)</span></div></el-card></el-col>
      <el-col :span="6"><el-card><div class="stat-label">关键路径节点</div><div class="stat-value" style="font-size: 24px; color: #f56c6c">{{ cpm.critical_path?.length || 0 }}</div></el-card></el-col>
      <el-col :span="6"><el-card><div class="stat-label">有浮动</div><div class="stat-value" style="font-size: 24px">{{ cpm.nodes_with_slack || 0 }}</div></el-card></el-col>
    </el-row>
  </div>
</template>

<script setup>
const props = defineProps({
  progress: { type: Object, required: true },
  cpm: { type: Object, required: true }
})
const formatWeeks = (w) => (w == null || isNaN(w)) ? '0' : Number(w).toFixed(1)
</script>
