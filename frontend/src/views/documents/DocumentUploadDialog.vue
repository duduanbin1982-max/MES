<template>
  <el-dialog v-model="visible" title="上传文档" width="640px" :close-on-click-modal="false">
    <el-form :model="uploadForm" label-width="100px" size="default">
      <el-form-item label="文件" required>
        <el-upload
          ref="uploadRef"
          :auto-upload="false"
          :limit="1"
          :on-change="(file: any) => $emit('file-change', file)"
          :on-exceed="() => ElMessage.warning('只能选择 1 个文件')"
          drag
        >
          <el-icon class="upload-icon"><UploadFilled /></el-icon>
          <div class="el-upload__text">拖拽文件到此处，或<em>点击选择</em></div>
          <template #tip>
            <div class="upload-tip">支持 PDF / Word / Excel / 图片 / DWG / STEP, 最大 50MB</div>
          </template>
        </el-upload>
      </el-form-item>
      <el-form-item label="文档标题" required>
        <el-input v-model="uploadForm.title" placeholder="例如: 机架总装图 A0" />
      </el-form-item>
      <el-form-item label="文档编码" required>
        <el-input v-model="uploadForm.doc_code" placeholder="例如: ZZ-001-A0" />
      </el-form-item>
      <el-form-item label="版本">
        <el-input v-model="uploadForm.version" placeholder="默认 A0" />
      </el-form-item>
      <el-form-item label="类型" required>
        <el-select v-model="uploadForm.doc_type" placeholder="请选择" style="width:100%">
          <el-option v-for="type in docTypes" :key="type.value" :label="type.label" :value="type.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="关联设备">
        <el-select v-model="uploadForm.equipment_instance_id" placeholder="可选" clearable filterable style="width:100%">
          <el-option v-for="instance in instances" :key="instance.id" :label="`${instance.instance_code || ''} ${instance.instance_name || ''}`" :value="instance.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="关联 BOM 节点">
        <el-select
          v-model="uploadForm.bom_node_id"
          :loading="bomLoading"
          :disabled="!uploadForm.equipment_instance_id"
          placeholder="先选择设备实例，再选择 BOM 节点"
          clearable
          filterable
          style="width:100%"
        >
          <el-option
            v-for="node in bomNodes"
            :key="node.id"
            :label="bomNodeLabel(node)"
            :value="node.id"
          />
        </el-select>
        <div class="upload-tip">绑定后可从 BOM / ECO / 车间端追溯到最新版图纸或 SOP。</div>
      </el-form-item>
      <el-form-item label="ECO 变更号">
        <el-input v-model="uploadForm.eco_id" placeholder="可选" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="uploadForm.description" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item label="标签">
        <el-input v-model="uploadForm.tags" placeholder="逗号分隔, 例如: 易损件,关键件" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="uploading" @click="$emit('submit', uploadRef?.uploadFiles || [])">提交上传</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const props = defineProps<{
  modelValue: boolean
  docTypes: Array<{ value: string; label: string }>
  instances: any[]
  bomNodes: any[]
  bomLoading: boolean
  uploading: boolean
}>()
// 2026-10-17（前端 eslint 棘轮）：被模板改写的对象 prop 改为 defineModel，
// 父组件用 v-model:xxx 绑定；改的仍是父组件同一对象，行为不变。
const uploadForm = defineModel<any>('uploadForm', { required: true })


const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'file-change': [file: any]
  submit: [uploadFiles: any[]]
}>()

const uploadRef = ref<any>(null)

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const bomNodeLabel = (node: any) => {
  const level = node.level_code || `L${node.tier ?? '-'}`
  const part = node.part_number || node.material_code || `BOM#${node.id}`
  const name = node.material_name || node.notes || ''
  return `${level} · ${part}${name ? ` · ${name}` : ''}`
}

defineExpose({
  clearFiles: () => uploadRef.value?.clearFiles(),
})
</script>

<style scoped>
.upload-icon {
  font-size: 48px;
  color: var(--el-color-primary);
}

.upload-tip {
  color: var(--el-color-info);
  font-size: 12px;
}
</style>
