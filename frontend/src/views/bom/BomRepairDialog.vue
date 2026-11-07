<template>
  <el-dialog v-model="visible" title="BOM 缺根修复向导" width="760px">
    <div v-if="loading" style="padding: 24px; text-align: center">正在诊断 BOM 结构…</div>
    <template v-else-if="preview">
      <el-alert
        :type="preview.root_count === 1 ? 'success' : 'warning'"
        :closable="false"
        show-icon
        :title="`当前 BOM ${preview.rows_count} 行，0 级根节点 ${preview.root_count} 个；健康分 ${preview.health?.grade || '-'} · ${preview.health?.score ?? '-'}`"
      />
      <div class="repair-meta">
        <el-tag size="small" type="info">无父节点 {{ preview.parentless_count }}</el-tag>
        <el-tag size="small" type="warning">孤儿 {{ preview.orphan_count }}</el-tag>
        <el-tag v-if="preview.cross_instance_count" size="small" type="danger">跨实例父节点 {{ preview.cross_instance_count }}</el-tag>
        <el-tag size="small" type="success">可自动修复 {{ preview.attachable_count }}</el-tag>
        <el-tag v-if="preview.manual_count" size="small" type="warning">需人工 {{ preview.manual_count }}</el-tag>
      </div>

      <el-card shadow="never" class="section">
        <template #header><span>修复动作</span></template>
        <el-checkbox-group v-model="selectedActions">
          <div v-for="action in preview.actions" :key="action.code" class="action-row">
            <el-checkbox v-if="action.code !== 'manual'" :value="action.code" :label="action.code">
              {{ action.label }}（{{ action.count }}）
            </el-checkbox>
            <span v-else class="manual-text">{{ action.label }}（{{ action.count }}）</span>
          </div>
        </el-checkbox-group>
        <el-form v-if="preview.root_count > 1" label-width="110px" style="margin-top: 12px">
          <el-form-item label="保留根节点">
            <el-select v-model="selectedRootId" placeholder="选择主根" style="width: 320px">
              <el-option v-for="root in preview.roots" :key="root.id" :label="`#${root.id} ${root.part_number || ''}`" :value="root.id" />
            </el-select>
          </el-form-item>
        </el-form>
        <div class="hint">创建根节点会新增一行 0 级整机节点；挂接只自动处理 1 级部件，2 级及以下无父节点仍需人工确认，避免误改结构。</div>
      </el-card>

      <el-card v-if="preview.health?.issues?.length" shadow="never" class="section">
        <template #header><span>健康问题（前 12 条）</span></template>
        <div v-for="(issue, index) in preview.health.issues.slice(0, 12)" :key="index" class="issue-row">
          <el-tag size="small" :type="issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'info'">{{ issue.severity }}</el-tag>
          <span>{{ issue.message }}</span>
        </div>
      </el-card>
    </template>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button :loading="loading" @click="load">重新诊断</el-button>
      <el-button type="primary" :disabled="!preview || !selectedActions.length" :loading="applying" @click="apply">执行修复</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Api } from '../../api'

const props = defineProps<{ modelValue: boolean; instanceId: number | null }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void; (event: 'changed'): void }>()
const visible = computed({ get: () => props.modelValue, set: (value: boolean) => emit('update:modelValue', value) })
const loading = ref(false)
const applying = ref(false)
const preview = ref<any>(null)
const selectedActions = ref<string[]>([])
const selectedRootId = ref<number | null>(null)

async function load() {
  if (!props.instanceId) return
  loading.value = true
  try {
    preview.value = await Api.get(`/equipment_instances/${props.instanceId}/bom/repair/preview`)
    selectedActions.value = (preview.value.actions || []).filter((action: any) => action.code !== 'manual' && !action.requires_root_id).map((action: any) => action.code)
    if (preview.value.roots?.length > 1) selectedRootId.value = preview.value.roots[0].id
  } catch (error: any) {
    ElMessage.error('诊断失败：' + (error.response?.data?.message || error.message))
  } finally {
    loading.value = false
  }
}

async function apply() {
  if (!props.instanceId) return
  applying.value = true
  try {
    const body: any = { actions: selectedActions.value }
    if (selectedRootId.value) body.root_bom_id = selectedRootId.value
    const result = await Api.post(`/equipment_instances/${props.instanceId}/bom/repair/apply`, body)
    ElMessage.success(`修复完成：根节点 ${result.before?.root_count ?? '-'} → ${result.after?.root_count ?? '-'}，健康分 ${result.before?.health_score ?? '-'} → ${result.health?.score ?? '-'}`)
    emit('changed')
    await load()
  } catch (error: any) {
    ElMessage.error('修复失败：' + (error.response?.data?.message || error.message))
  } finally {
    applying.value = false
  }
}

watch(() => [props.modelValue, props.instanceId], ([open]) => { if (open) load() }, { immediate: true })
</script>

<style scoped>
.repair-meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.section { margin-top: 12px; }
.action-row { padding: 4px 0; }
.manual-text { color: var(--el-color-warning); font-size: 13px; }
.hint { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; margin-top: 8px; }
.issue-row { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; font-size: 13px; }
</style>
