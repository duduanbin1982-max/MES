<template>
  <el-card>
    <template #header>
      <div style="display: flex; align-items: center; justify-content: space-between">
        <span>{{ tierName(tier) }} 清单 ({{ rows.length }} 项)</span>
        <div>
          <el-button v-if="tier >= 1 && tier <= 2" size="small" type="primary" @click="$emit('add')">+ 新增</el-button>
        </div>
      </div>
    </template>
    <el-table :data="rows" size="small" max-height="550" stripe @row-click="onRow">
      <el-table-column prop="id" label="ID" width="50" />
      <el-table-column v-if="tier > 0" label="物料" min-width="180">
        <template #default="{ row }">
          <span style="font-weight: 500">{{ row.material_name || row.part_number || '(无)' }}</span>
          <span style="color: #909399; font-size: 11px; margin-left: 4px">{{ row.material_code || '' }}</span>
        </template>
      </el-table-column>
      <el-table-column v-else label="整机" min-width="180">
        <template #default="{ row }">{{ row.material_name || row.part_number || `设备 #${row.id}` }}</template>
      </el-table-column>
      <el-table-column prop="part_number" label="图号/型号" min-width="120" />
      <el-table-column prop="quantity" label="数量" width="80" />
      <el-table-column prop="unit" label="单位" width="60" />
      <el-table-column prop="category" label="分类" min-width="100" />
      <el-table-column prop="material_grade" label="材质" min-width="100" />
      <el-table-column prop="brand_recommend" label="品牌" min-width="90">
        <template #default="{ row }">
          {{ row.brand_recommend || '-' }}
          <el-tag v-if="row.brand_grade === 'A'" size="small" type="success">A</el-tag>
          <el-tag v-else-if="row.brand_grade === 'B'" size="small">B</el-tag>
          <el-tag v-else-if="row.brand_grade === '不可替代'" size="small" type="danger">不可</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="标识" width="140">
        <template #default="{ row }">
          <el-tag v-if="row.is_phantom" size="small">虚</el-tag>
          <el-tag v-if="row.is_key_component" size="small" type="danger" style="margin-left: 2px">关键</el-tag>
          <el-tag v-if="row.is_wear_part" size="small" type="warning" style="margin-left: 2px">易损</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="unit_price" label="单价" width="80" :formatter="(r) => r.unit_price || '-'" />
      <el-table-column v-if="showActions !== false" label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button v-if="tier === 1" size="small" link type="primary" @click.stop="$emit('drill', row)">下钻</el-button>
          <el-button size="small" link type="danger" @click.stop="$emit('delete', row)">删</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
const props = defineProps<{ rows: any[]; tier: number; showActions?: boolean }>()
const emit = defineEmits(['select', 'add', 'delete', 'drill'])
function tierName(t: number) {
  return ['0 总装', '1 部件', '2 零件', '3 毛坯'][t] || t
}
function onRow(row: any) { emit('select', row) }
</script>
