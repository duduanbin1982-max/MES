<template>
  <el-dialog v-model="visible" :title="form.id ? '编辑工位' : '新建工位'" width="620px">
    <el-form :model="form" label-width="100px">
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="工位编码" required><el-input v-model="form.code" :disabled="!!form.id" placeholder="WS-ASM-01" /></el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="工位名称" required><el-input v-model="form.name" placeholder="总装工位1" /></el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="工位类型" required>
            <el-select v-model="form.station_type" style="width: 100%" @change="$emit('fill-defaults')">
              <el-option v-for="type in stationTypes" :key="type.value" :label="type.label" :value="type.value" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="工位状态">
            <el-select v-model="form.status" style="width: 100%">
              <el-option label="可用" value="available" />
              <el-option label="占用" value="occupied" />
              <el-option label="维护" value="maintenance" />
              <el-option label="阻塞" value="blocked" />
              <el-option label="停用" value="disabled" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="车间"><el-input v-model="form.workshop" placeholder="总装/焊接/机加/质检" /></el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="位置"><el-input v-model="form.location" placeholder="A 区 / 质检区" /></el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="日产能"><el-input-number v-model="form.capacity_per_day" :min="1" style="width: 100%" /></el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="人数上限"><el-input-number v-model="form.max_workers" :min="1" style="width: 100%" /></el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="班次">
            <el-select v-model="form.shift" style="width: 100%">
              <el-option label="白班" value="day" />
              <el-option label="夜班" value="night" />
              <el-option label="双班" value="double" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="状态"><el-switch v-model="form.is_active" active-text="启用" inactive-text="停用" /></el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="能力标签">
            <el-select v-model="form.capability_tags" multiple filterable allow-create default-first-option style="width: 100%">
              <el-option v-for="tag in commonTags" :key="tag" :label="tag" :value="tag" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="要求技能">
            <el-select v-model="form.required_skills" multiple filterable allow-create default-first-option style="width: 100%">
              <el-option v-for="tag in commonTags" :key="tag" :label="tag" :value="tag" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="备注"><el-input v-model="form.notes" type="textarea" :rows="2" /></el-form-item>
        </el-col>
      </el-row>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="$emit('save')" :loading="saving">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean
  form: any
  stationTypes: any[]
  commonTags: string[]
  saving: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: []
  'fill-defaults': []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})
</script>
