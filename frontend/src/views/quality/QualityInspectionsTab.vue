<template>
  <div>
    <el-row :gutter="16" class="quality-stat-row">
      <el-col :span="6"><el-card><div class="stat-card"><div class="stat-label">总检数</div><div class="stat-value">{{ stats.total || 0 }}</div></div></el-card></el-col>
      <el-col :span="6"><el-card><div class="stat-card"><div class="stat-label"><el-icon><Select /></el-icon> 通过</div><div class="stat-value pass">{{ stats.pass || 0 }}</div></div></el-card></el-col>
      <el-col :span="6"><el-card><div class="stat-card"><div class="stat-label"><el-icon><Close /></el-icon> 不通过</div><div class="stat-value fail">{{ stats.fail || 0 }}</div></div></el-card></el-col>
      <el-col :span="6"><el-card><div class="stat-card"><div class="stat-label">合格率</div><div class="stat-value" :style="{color: (stats.pass_rate||0) >= 95 ? 'var(--el-color-success)' : 'var(--el-color-warning)'}">{{ stats.pass_rate || 0 }}%</div></div></el-card></el-col>
    </el-row>
    <el-alert v-if="isScoped" type="info" :closable="false" show-icon class="entry-alert">
      <template #title>当前入口：{{ inspectionEntry.title }}</template>
      <div class="entry-alert-body">
        <span>{{ inspectionEntry.subtitle }}，已自动筛选「{{ typeLabel(filters.inspection_type) }}」。</span>
        <el-button link type="primary" @click="$emit('clear-scope')">查看全部检验</el-button>
      </div>
    </el-alert>
    <el-card>
      <div class="toolbar">
        <el-form :inline="true" :model="filters" size="default">
          <el-form-item label="实例">
            <el-select v-model="filters.equipment_instance_id" clearable placeholder="全部" class="instance-select">
              <el-option v-for="item in instances" :key="item.id" :label="item.instance_code" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="类型">
            <el-select v-model="filters.inspection_type" clearable placeholder="全部" class="type-select" :disabled="isScoped">
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
        <el-button type="primary" @click="$emit('create')">+ 新建{{ inspectionEntry.createLabel }}</el-button>
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
          <template #default="{ row }"><el-tag :type="row.result === 'pass' ? 'success' : 'danger'" size="small"><template v-if="row.result === 'pass'"><el-icon><Select /></el-icon> 通过</template><template v-else><el-icon><Close /></el-icon> 不通过</template></el-tag></template>
        </el-table-column>
        <el-table-column prop="inspector_name" label="检验员" width="100" />
        <el-table-column prop="inspection_date" label="日期" width="170" />
        <el-table-column prop="notes" label="备注" min-width="200" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
type InspectionEntry = { title: string; subtitle: string; badge: string; createLabel: string }

defineProps<{
  stats: any
  instances: any[]
  types: Array<{ value: string, label: string }>
  rows: any[]
  loading: boolean
  typeLabel: (value: string) => string
  typeColor: (value: string) => string
  inspectionEntry: InspectionEntry
  isScoped: boolean
}>()

// 2026-10-17（前端 eslint 棘轮）：filters 改为 defineModel，父组件用 v-model:filters 绑定；
// 模板里改写的仍是父组件同一个对象，行为不变。
const filters = defineModel<Record<string, any>>('filters', { required: true })

defineEmits<{
  (event: 'load'): void
  (event: 'create'): void
  (event: 'clear-scope'): void
}>()
</script>

<style scoped>
.quality-stat-row{margin-bottom:12px}
.entry-alert{margin-bottom:12px}
.entry-alert-body{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.toolbar{display:flex;justify-content:space-between;align-items:center}
.instance-select{width:220px}
.type-select{width:140px}
.result-select{width:100px}
.table-card{margin-top:12px}
.stat-card{text-align:center}
.stat-label{font-size:13px;color:var(--el-color-info);margin-bottom:6px}
.stat-value{font-size:26px;font-weight:700}
.stat-value.pass{color:var(--el-color-success)}
.stat-value.fail{color:var(--el-color-danger)}
</style>
