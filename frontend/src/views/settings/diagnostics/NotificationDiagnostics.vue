<template>
  <el-row :gutter="14">
    <el-col :xs="24" :lg="12">
      <el-card shadow="never" class="diag-card">
        <template #header>
          <div class="card-header">
            <span>飞书通知链路</span>
            <el-button size="small" @click="$emit('send-feishu-test')" :loading="actionLoading === 'feishu'">发送测试</el-button>
          </div>
        </template>
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="启用状态">
            <el-tag :type="feishuDiag?.enabled ? 'success' : 'warning'">{{ feishuDiag?.enabled ? '已启用' : '未启用' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="Webhook">
            <span class="mono">{{ feishuDiag?.webhook_token_preview || '-' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="配置提示">{{ feishuDiag?.note || '-' }}</el-descriptions-item>
          <el-descriptions-item v-if="probeResult" label="探测结果">
            <el-tag :type="probeResult?.result?.ok ? 'success' : 'danger'">{{ probeResult?.result?.ok ? '可达' : '失败' }}</el-tag>
            <span class="diag-inline">{{ probeResult?.next_step || probeResult?.result?.error || '' }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <el-table :data="feishuDiag?.queue_recent_5 || []" size="small" class="diag-table" max-height="220">
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column prop="ts" label="时间" width="150" />
          <el-table-column prop="line" label="队列记录" min-width="240" show-overflow-tooltip />
        </el-table>
      </el-card>
    </el-col>

    <el-col :xs="24" :lg="12">
      <el-card shadow="never" class="diag-card">
        <template #header>
          <div class="card-header">
            <span>ANDON 告警链路</span>
            <el-tag :type="andonDiag?.channels_active ? 'success' : 'warning'" effect="light">
              渠道 {{ andonDiag?.channels_active || 0 }}
            </el-tag>
          </div>
        </template>
        <el-row :gutter="10" class="mini-metrics">
          <el-col :span="8"><div><strong>{{ andonDiag?.open_alerts || 0 }}</strong><span>未关闭</span></div></el-col>
          <el-col :span="8"><div><strong>{{ andonDiag?.alerts_last_24h || 0 }}</strong><span>24h 告警</span></div></el-col>
          <el-col :span="8"><div><strong>{{ andonDiag?.active_rules || 0 }}</strong><span>规则</span></div></el-col>
        </el-row>
        <el-alert :title="andonDiag?.note || '暂无诊断信息'" :type="andonDiag?.channels_active ? 'success' : 'warning'" :closable="false" show-icon />
        <el-table :data="andonDiag?.recent_alerts || []" size="small" class="diag-table" max-height="260">
          <el-table-column prop="severity" label="等级" width="82" />
          <el-table-column prop="title" label="告警" min-width="180" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column prop="created_at" label="时间" width="150" />
        </el-table>
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
defineProps<{
  actionLoading: string
  feishuDiag: any
  andonDiag: any
  probeResult: any
}>()

defineEmits<{
  'send-feishu-test': []
}>()
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.diag-card {
  margin-bottom: 14px;
}

.diag-table {
  margin-top: 12px;
}

.mini-metrics {
  margin-bottom: 12px;
}

.mini-metrics div {
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--color-surface-muted);
}

.mini-metrics strong {
  color: var(--el-color-primary);
  font-family: "Fira Code", "Cascadia Code", monospace;
  font-size: 20px;
}

.mini-metrics span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.diag-inline {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
}

@media (max-width: 768px) {
  .card-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
