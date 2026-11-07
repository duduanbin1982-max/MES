<template>
  <el-dialog v-model="visible" title="BOM 版本 Redline 对比" width="900px">
    <el-form inline>
      <el-form-item label="BOM 类型">
        <el-select v-model="bomType" style="width: 120px" @change="loadReleases">
          <el-option label="EBOM" value="EBOM" />
          <el-option label="MBOM" value="MBOM" />
        </el-select>
      </el-form-item>
      <el-form-item label="基准版本">
        <el-select v-model="fromId" placeholder="选择版本" style="width: 200px">
          <el-option v-for="release in releases" :key="release.id" :label="`${release.version} · ${release.status}`" :value="release.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="对比版本">
        <el-select v-model="toId" placeholder="选择版本" style="width: 200px">
          <el-option v-for="release in releases" :key="release.id" :label="`${release.version} · ${release.status}`" :value="release.id" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="comparing" @click="compare">开始对比</el-button>
      </el-form-item>
    </el-form>
    <el-alert v-if="!releases.length" type="info" :closable="false" show-icon title="该类型还没有已发布版本，请先发布 BOM 版本。" />
    <template v-else-if="result">
      <el-row :gutter="12" style="margin: 8px 0 12px">
        <el-col :span="6"><el-statistic title="新增" :value="result.summary?.added || 0" /></el-col>
        <el-col :span="6"><el-statistic title="删除" :value="result.summary?.removed || 0" /></el-col>
        <el-col :span="6"><el-statistic title="变更" :value="result.summary?.changed || 0" /></el-col>
        <el-col :span="6"><el-statistic title="数量差 / 金额差" :value="`${result.summary?.quantity_delta ?? 0} / ¥${result.summary?.amount_delta ?? 0}`" /></el-col>
      </el-row>
      <el-tabs>
        <el-tab-pane :label="`新增 (${result.added?.length || 0})`" name="added">
          <el-table :data="result.added" size="small" max-height="300">
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column prop="part_number" label="零件号" min-width="150" />
            <el-table-column prop="quantity" label="数量" width="80" />
            <el-table-column prop="unit" label="单位" width="70" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="`删除 (${result.removed?.length || 0})`" name="removed">
          <el-table :data="result.removed" size="small" max-height="300">
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column prop="part_number" label="零件号" min-width="150" />
            <el-table-column prop="quantity" label="数量" width="80" />
            <el-table-column prop="unit" label="单位" width="70" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="`变更 (${result.changed?.length || 0})`" name="changed">
          <el-table :data="result.changed" size="small" max-height="300">
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column prop="part_number" label="零件号" min-width="130" />
            <el-table-column label="变更字段" min-width="200">
              <template #default="{ row }">{{ (row.fields || []).join('、') || (row.moved ? '父节点移动' : '-') }}</template>
            </el-table-column>
            <el-table-column label="移动" width="70"><template #default="{ row }">{{ row.moved ? '是' : '-' }}</template></el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Api } from '../../api'

const props = defineProps<{ modelValue: boolean; instanceId: number | null }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()
const visible = computed({ get: () => props.modelValue, set: (value: boolean) => emit('update:modelValue', value) })
const bomType = ref('MBOM')
const releases = ref<any[]>([])
const fromId = ref<number | null>(null)
const toId = ref<number | null>(null)
const loading = ref(false)
const comparing = ref(false)
const result = ref<any>(null)

async function loadReleases() {
  if (!props.instanceId) return
  loading.value = true
  try {
    const data: any = await Api.get(`/equipment_instances/${props.instanceId}/bom/versions?bom_type=${bomType.value}`)
    releases.value = data.items || []
    fromId.value = releases.value[1]?.id || releases.value[0]?.id || null
    toId.value = releases.value[0]?.id || null
    result.value = null
  } catch (error: any) {
    ElMessage.error('加载版本失败：' + (error.response?.data?.message || error.message))
  } finally {
    loading.value = false
  }
}

async function compare() {
  if (!props.instanceId || !fromId.value || !toId.value) return
  comparing.value = true
  try {
    result.value = await Api.get(`/equipment_instances/${props.instanceId}/bom/redline?from_release_id=${fromId.value}&to_release_id=${toId.value}`)
  } catch (error: any) {
    ElMessage.error('Redline 对比失败：' + (error.response?.data?.message || error.message))
  } finally {
    comparing.value = false
  }
}

watch(() => [props.modelValue, props.instanceId], ([open]) => { if (open) loadReleases() }, { immediate: true })
</script>

<style scoped>
:deep(.el-statistic__number) { font-size: 20px; }
</style>
