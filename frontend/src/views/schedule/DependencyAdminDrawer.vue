<template>
  <el-drawer
    :model-value="modelValue"
    title="依赖维护（类型 / 间隔）"
    size="920px"
    @update:model-value="(value: boolean) => emit('update:modelValue', value)"
    @open="onOpen"
  >
    <div class="dep-admin">
      <el-alert v-if="!props.instanceId" type="info" :closable="false" show-icon class="dep-alert">
        <template #title>选择一个项目后维护它的工序依赖（类型 FS/SS/FF/SF + 间隔小时）</template>
      </el-alert>

      <div class="dep-toolbar">
        <div class="dep-filter">
          <span class="dep-label">项目</span>
          <el-select
            v-model="currentInstance"
            placeholder="选择项目"
            filterable
            style="width: 300px"
            @change="load"
          >
            <el-option
              v-for="item in instances"
              :key="item.id"
              :label="`${item.instance_code || ''} · ${item.instance_name || ''}`"
              :value="item.id"
            />
          </el-select>
          <el-tag v-if="currentInstance" size="small" type="info">{{ items.length }} 条依赖 · {{ nodes.length }} 个工序</el-tag>
        </div>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>

      <!-- 新增依赖 -->
      <el-card class="dep-add-card" shadow="never">
        <div class="dep-add-title">新增依赖</div>
        <div class="dep-add-row">
          <el-select v-model="draft.predecessor_id" placeholder="前驱工序" filterable style="width: 240px">
            <el-option v-for="node in nodes" :key="'p' + node.id" :label="nodeOptionLabel(node)" :value="node.id" />
          </el-select>
          <span class="dep-arrow">→</span>
          <el-select v-model="draft.successor_id" placeholder="后继工序" filterable style="width: 240px">
            <el-option v-for="node in nodes" :key="'s' + node.id" :label="nodeOptionLabel(node)" :value="node.id" />
          </el-select>
          <el-select v-model="draft.dep_type" style="width: 130px">
            <el-option v-for="type in DEP_TYPES" :key="type" :label="`${type} ${depTypeLabel(type)}`" :value="type" />
          </el-select>
          <el-input-number v-model="draft.lag_hours" :min="0" :max="MAX_LAG_HOURS" :step="1" controls-position="right" style="width: 130px" />
          <span class="dep-unit">小时</span>
          <el-button type="primary" size="small" :loading="adding" :disabled="!currentInstance" @click="addDependency">添加</el-button>
        </div>
        <div class="dep-add-hint">{{ depTypeHint(draft.dep_type) }}；后端会校验自依赖 / 重复 / 跨项目 / 环。</div>
      </el-card>

      <el-table :data="items" size="small" border v-loading="loading" empty-text="该项目还没有依赖">
        <el-table-column label="前驱工序" min-width="200">
          <template #default="{ row }">
            <span class="dep-node">{{ row.predecessor_name || `#${row.predecessor_id}` }}</span>
            <span class="dep-node-id">#{{ row.predecessor_id }}</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="150">
          <template #default="{ row }">
            <el-select v-model="row.dep_type" size="small" style="width: 100%">
              <el-option v-for="type in DEP_TYPES" :key="type" :label="`${type} ${depTypeLabel(type)}`" :value="type" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="间隔(h)" width="130">
          <template #default="{ row }">
            <el-input-number v-model="row.lag_hours" size="small" :min="0" :max="MAX_LAG_HOURS" controls-position="right" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="间隔展示" width="120">
          <template #default="{ row }">{{ formatLagHours(row.lag_hours) }}</template>
        </el-table-column>
        <el-table-column label="后继工序" min-width="200">
          <template #default="{ row }">
            <span class="dep-node">{{ row.successor_name || `#${row.successor_id}` }}</span>
            <span class="dep-node-id">#{{ row.successor_id }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link :loading="savingId === row.id" @click="saveRow(row)">保存</el-button>
            <el-button size="small" type="danger" link @click="removeRow(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="dep-foot-hint">
        提示：改了间隔后，甘特图的依赖线会按 `lag_hours / 24 × 天宽` 错开并变成虚线；
        类型的语义见上方说明（当前仅几何上使用 FS 的间隔）。
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../../api'
import {
  DEP_TYPES,
  MAX_LAG_HOURS,
  depTypeHint,
  depTypeLabel,
  formatLagHours,
  nodeOptionLabel,
  validateDependencyDraft,
} from '../../domain/dependencyAdmin'

const props = defineProps<{
  modelValue: boolean
  instanceId?: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  changed: []
}>()

const loading = ref(false)
const adding = ref(false)
const savingId = ref<number | null>(null)
const items = ref<any[]>([])
const nodes = ref<any[]>([])
const instances = ref<any[]>([])
const currentInstance = ref<number | null>(props.instanceId ?? null)
const draft = reactive<{ predecessor_id: number | null; successor_id: number | null; dep_type: string; lag_hours: number }>({
  predecessor_id: null,
  successor_id: null,
  dep_type: 'FS',
  lag_hours: 0,
})

const loadInstances = async () => {
  if (instances.value.length) return
  try {
    const result: any = await Api.get('/equipment_instances')
    instances.value = Array.isArray(result) ? result : result?.items || []
  } catch (_error) {
    // 拉不到项目列表时，仍允许用外部传入的 instanceId 工作
  }
}

const load = async () => {
  if (!currentInstance.value) {
    items.value = []
    nodes.value = []
    return
  }
  loading.value = true
  try {
    const result: any = await Api.get('/process_dependencies', { params: { instance_id: currentInstance.value } })
    items.value = result?.items || []
    nodes.value = result?.nodes || []
  } catch (error: any) {
    ElMessage.error('加载依赖失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    loading.value = false
  }
}

const onOpen = async () => {
  if (props.instanceId && currentInstance.value !== props.instanceId) {
    currentInstance.value = props.instanceId
  }
  await loadInstances()
  await load()
}

const addDependency = async () => {
  if (!currentInstance.value) return
  const check = validateDependencyDraft(draft)
  if (!check.ok) {
    ElMessage.warning(check.errors[0])
    return
  }
  adding.value = true
  try {
    await Api.post('/process_dependencies', {
      equipment_instance_id: currentInstance.value,
      predecessor_id: draft.predecessor_id,
      successor_id: draft.successor_id,
      dep_type: draft.dep_type,
      lag_hours: draft.lag_hours,
    })
    ElMessage.success('依赖已添加')
    draft.predecessor_id = null
    draft.successor_id = null
    draft.dep_type = 'FS'
    draft.lag_hours = 0
    await load()
    emit('changed')
  } catch (error: any) {
    ElMessage.error('添加失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    adding.value = false
  }
}

const saveRow = async (row: any) => {
  savingId.value = row.id
  try {
    await Api.put(`/process_dependencies/${row.id}`, { dep_type: row.dep_type, lag_hours: row.lag_hours })
    ElMessage.success('已保存')
    await load()
    emit('changed')
  } catch (error: any) {
    ElMessage.error('保存失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    savingId.value = null
  }
}

const removeRow = async (row: any) => {
  try {
    await ElMessageBox.confirm(`删除依赖：${row.predecessor_name || row.predecessor_id} → ${row.successor_name || row.successor_id}？`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await Api.delete(`/process_dependencies/${row.id}`)
    ElMessage.success('已删除')
    await load()
    emit('changed')
  } catch (error: any) {
    ElMessage.error('删除失败: ' + (error?.response?.data?.message || error?.message || error))
  }
}
</script>

<style scoped>
.dep-admin {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dep-alert {
  margin-bottom: 4px;
}

.dep-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dep-filter {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dep-label {
  font-size: 12px;
  color: var(--el-color-info);
}

.dep-add-card {
  border-radius: 10px;
}

.dep-add-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 8px;
}

.dep-add-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.dep-arrow {
  color: var(--el-color-primary);
  font-weight: 600;
}

.dep-unit {
  font-size: 12px;
  color: var(--el-color-info);
}

.dep-add-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-color-info);
}

.dep-node {
  font-size: 13px;
}

.dep-node-id {
  margin-left: 6px;
  font-size: 11px;
  color: var(--el-color-info);
  font-family: Consolas, monospace;
}

.dep-foot-hint {
  font-size: 12px;
  color: var(--el-color-info);
  line-height: 1.6;
}
</style>
