<template>
  <el-card shadow="never">
    <div class="mat-toolbar">
      <el-tree-select v-model="categoryId" :data="categoryTree" :props="{ label: 'category_name', value: 'id', children: 'children' }"
        check-strictly clearable placeholder="按分类筛选（含子类）" style="width: 300px" @change="loadMats" />
      <span class="mat-hint">选择大类会包含其下所有子类</span>
    </div>
    <el-table :data="mats" stripe v-loading="loading" size="small">
      <el-table-column prop="material_code" label="编码" width="140" />
      <el-table-column prop="material_name" label="名称" min-width="200" />
      <el-table-column label="分类" width="170">
        <template #default="{ row }">
          <span v-if="row.category_name">{{ row.category_code }} {{ row.category_name }}</span>
          <span v-else class="mat-muted">未分类</span>
        </template>
      </el-table-column>
      <el-table-column prop="material_type" label="类型" width="100" />
      <el-table-column prop="spec" label="规格" width="150" />
      <el-table-column prop="unit" label="单位" width="60" />
      <el-table-column label="自制" width="70">
        <template #default="{ row }">
          <el-tag v-if="row.is_self_made" type="success" size="small">自制</el-tag>
          <el-tag v-else size="small">外购</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="关键件" width="80">
        <template #default="{ row }">
          <el-tag v-if="row.is_key_component" type="danger" size="small">⭐ 关键</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="default_supplier" label="默认供应商" width="140" />
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '../../api'
import { computed } from 'vue'

defineProps<{ tab: string }>()
const mats = ref<any[]>([])
const loading = ref(false)
const categoryId = ref<number | null>(null)
const categories = ref<any[]>([])
const categoryTree = computed(() => {
  const map = new Map<number, any>()
  const roots: any[] = []
  for (const row of categories.value) map.set(row.id, { ...row, children: [] })
  for (const row of categories.value) {
    const node = map.get(row.id)
    const parent = row.parent_id ? map.get(row.parent_id) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
})
const loadMats = async () => {
  loading.value = true
  try { mats.value = await api.materials(categoryId.value ? { category_id: categoryId.value } : undefined) } catch(e) { /* 前端统一用 ElMessage 提示 */ } finally { loading.value = false }
}
const load = async () => {
  try { categories.value = await api.materialCategories() } catch(e) { categories.value = [] }
  await loadMats()
}
onMounted(load)
</script>

<style scoped>
.mat-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.mat-hint { color: var(--el-text-color-secondary); font-size: 12px; }
.mat-muted { color: var(--el-text-color-placeholder); }
</style>