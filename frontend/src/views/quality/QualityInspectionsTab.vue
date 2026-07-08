<template>
  <div>
    <el-row :gutter="16" class="quality-stat-row">
      <el-col :span="6"><el-card><div class="stat-card"><div class="stat-label">总检数</div><div class="stat-value">{{ stats.total || 0 }}</div></div></el-card></el-col>
      <el-col :span="6"><el-card><div class="stat-card"><div class="stat-label">✓ 通过</div><div class="stat-value pass">{{ stats.pass || 0 }}</div></div></el-card></el-col>
      <el-col :span="6"><el-card><div class="stat-card"><div class="stat-label">✗ 不通过</div><div class="stat-value fail">{{ stats.fail || 0 }}</div></div></el-card></el-col>
      <el-col :span="6"><el-card><div class="stat-card"><div class="stat-label">合格率</div><div class="stat-value" :style="{color: (stats.pass_rate||0) >= 95 ? '#67c23a' : '#e6a23c'}">{{ stats.pass_rate || 0 }}%</div></div></el-card></el-col>
    </el-row>
    <el-card>
      <div class="toolbar">
        <el-form :inline="true" :model="filters" size="default">
          <el-form-item label="实例">
            <el-select v-model="filters.equipment_instance_id" clearable placeholder="全部" class="instance-select">
              <el-option v-for="item in instances" :key="item.id" :label="item.instance_code" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="类型">
            <el-select v-model="filters.inspection_type" clearable placeholder="全部" class="type-select">
              <el-option v-for="type in types" :key="type.value" :label="type.label" :value="type.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="结果">
            <el-select v-model="filters.result" clearable placeholder="全部" class="result-select">
              <el-option label="通过" value="pass" />
              <el-option label="不通过" value="fail" />
            </el-select>
          </el-form-item>
          <el-form-item><el-button type="primary" @click="$emit('load')">查询</el-button></el-form-item>
        </el-form>
        <el-button type="primary" @click="$emit('create')">+ 新建质检记录</el-button>
      </div>
    </el-card>
    <el-card class="table-card">
      <el-table :data="rows" stripe v-loading="loading" size="small">
        <el-table-column prop="instance_code" label="实例" width="140" />
        <el-table-column prop="wo_code" label="工单" width="160" />
        <el-table-column label="类型" width="120">
          <template #default="{ row }"><el-tag size="small" :type="typeColor(row.inspection_type)">{{ typeLabel(row.inspection_type) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="结果" width="100">
          <template #default="{ row }"><el-tag :type="row.result === 'pass' ? 'success' : 'danger'" size="small">{{ row.result === 'pass' ? '✓ 通过' : '✗ 不通过' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="inspector_name" label="检验员" width="100" />
        <el-table-column prop="inspection_date" label="日期" width="170" />
        <el-table-column prop="notes" label="备注" min-width="200" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  stats: any
  filters: any
  instances: any[]
  types: Array<{ value: string, label: string }>
  rows: any[]
  loading: boolean
  typeLabel: (value: string) => string
  typeColor: (value: string) => string
}>()

defineEmits<{
  (event: 'load'): void
  (event: 'create'): void
}>()
</script>

<style scoped>
.quality-stat-row{margin-bottom:12px}
.toolbar{display:flex;justify-content:space-between;align-items:center}
.instance-select{width:220px}
.type-select{width:140px}
.result-select{width:100px}
.table-card{margin-top:12px}
.stat-card{text-align:center}
.stat-label{font-size:13px;color:#909399;margin-bottom:6px}
.stat-value{font-size:26px;font-weight:700}
.stat-value.pass{color:#67c23a}
.stat-value.fail{color:#f56c6c}
</style>
