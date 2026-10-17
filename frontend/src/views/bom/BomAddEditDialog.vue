<template>
  <el-dialog v-model="dlgAddModel" :title="editingNode ? `编辑节点 #${editingNode.id}` : '新增项目结构节点'" width="780px" @closed="emit('reset-add-form')">
    <el-form :model="addForm" label-width="100px" size="small">
      <el-row :gutter="12">
        <el-col :span="8">
          <el-form-item label="层级" required>
            <el-input-number v-model="addForm.tier" :min="0" :step="1" disabled style="width: 100%" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="层级号">
            <el-input v-model="addForm.level_code" placeholder="保存后自动生成" disabled />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="节点类型">
            <el-select v-model="addForm.node_type" style="width: 100%" @change="emit('node-type-change', $event)">
              <el-option v-for="item in NODE_TYPE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="16">
          <el-form-item label="父节点">
            <el-select v-model="addForm.parent_id" filterable clearable style="width: 100%" @change="emit('parent-change', $event)">
              <el-option
                v-for="p in allNodes"
                :key="p.id"
                :label="`${p.level_code || '#'+p.id} · ${p.material_name || p.part_number || '未命名'} · ${tierLabel(p.tier)}`"
                :value="p.id"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="物料" v-if="addForm.tier > 0">
            <el-select v-model="addForm.material_id" filterable clearable style="width: 100%">
              <el-option v-for="m in materials" :key="m.id" :label="`${m.material_code} · ${m.material_name}`" :value="m.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8"><el-form-item label="数量" required><el-input-number v-model="addForm.quantity" :min="0.0001" :step="1" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="单位" required><el-select v-model="addForm.unit"><el-option v-for="u in UNIT_OPTIONS" :key="u" :label="u" :value="u" /></el-select></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="分类" required><el-select v-model="addForm.category"><el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" /></el-select></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="图号/型号"><el-input v-model="addForm.part_number" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="材质"><el-input v-model="addForm.material_grade" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="表面处理"><el-input v-model="addForm.surface_treatment" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="品牌/等级"><el-input v-model="addForm.brand_recommend" v-if="addForm.brand_grade === '不可替代'" placeholder="不可替代" disabled /><el-input aria-label="品牌推荐" v-model="addForm.brand_recommend" v-else placeholder="品牌推荐" /><el-select v-model="addForm.brand_grade" size="small" style="width: 90px; margin-left: 4px"><el-option label="A" value="A" /><el-option label="B" value="B" /><el-option label="不可" value="不可替代" /></el-select></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="损耗"><el-input-number v-model="addForm.scrap_factor" :min="1.0" :max="2.0" :step="0.05" :precision="2" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="单价"><el-input-number v-model="addForm.unit_price" :min="0" :precision="2" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="存放"><el-input v-model="addForm.storage_location" /></el-form-item></el-col>
        <el-col :span="24"><el-form-item label="标识"><el-checkbox v-model="addForm.is_phantom">虚项</el-checkbox><el-checkbox v-model="addForm.is_key_component">关键</el-checkbox><el-checkbox v-model="addForm.is_wear_part">易损</el-checkbox></el-form-item></el-col>
        <el-col :span="24"><el-form-item label="备注"><el-input v-model="addForm.notes" type="textarea" :rows="2" /></el-form-item></el-col>
      </el-row>
    </el-form>
    <template #footer>
      <el-button @click="dlgAddModel = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="emit('save')">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CATEGORY_OPTIONS, NODE_TYPE_OPTIONS, UNIT_OPTIONS, tierLabel } from './bomShared'

const props = defineProps<{
  dlgAdd: boolean
  editingNode: any
  allNodes: any[]
  materials: any[]
  saving: boolean
}>()
// 2026-10-17（前端 eslint 棘轮）：被模板改写的对象 prop 改为 defineModel，
// 父组件用 v-model:xxx 绑定；改的仍是父组件同一对象，行为不变。
const addForm = defineModel<any>('addForm', { required: true })


const emit = defineEmits<{
  (event: 'update:dlgAdd', value: boolean): void
  (event: 'reset-add-form'): void
  (event: 'parent-change', parentId: number | null): void
  (event: 'node-type-change', nodeType: string): void
  (event: 'save'): void
}>()

const dlgAddModel = computed({ get: () => props.dlgAdd, set: (value: boolean) => emit('update:dlgAdd', value) })
</script>
