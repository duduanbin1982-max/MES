<template>
      <!-- ===== Tab 1: 供应商管理 ===== -->
      <el-tab-pane label="供应商管理" name="suppliers">
        <el-row :gutter="12" class="setup-row">
          <el-col :span="6">
            <el-card shadow="never" class="setup-card">
              <div class="setup-label">供应商总数</div>
              <div class="setup-value">{{ supplierSetup.total || 0 }}</div>
              <div class="setup-sub">启用 {{ supplierSetup.active || 0 }}</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="never" class="setup-card">
              <div class="setup-label">关键件供应商</div>
              <div class="setup-value">{{ supplierSetupCount('key_component') }}</div>
              <div class="setup-sub">主轴承/液压/电气</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="never" class="setup-card">
              <div class="setup-label">外协供应商</div>
              <div class="setup-value">{{ supplierSetupCount('outsourcing') }}</div>
              <div class="setup-sub">机加/热处理/喷涂</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="never" class="setup-card">
              <div class="setup-label">必备分类覆盖</div>
              <div class="setup-value">{{ supplierSetup.required_covered || 0 }}/{{ supplierSetup.required_total || 0 }}</div>
              <div class="setup-sub">关键件 / 外协 / 标准件</div>
            </el-card>
          </el-col>
        </el-row>

        <el-alert
          v-if="supplierSetup.missing_required?.length"
          type="warning"
          :closable="false"
          show-icon
          class="supplier-alert"
        >
          <template #title>
            采购首日建档还缺：{{ supplierSetup.missing_required.map((item: any) => item.label).join('、') }}
          </template>
          <template #default>
            <div class="quick-actions" style="margin-top: 8px;">
              <el-button type="primary" size="small" @click="emit('bootstrap-defaults')">一键补首日模板</el-button>
              <el-button
                v-for="tpl in missingTemplates"
                :key="tpl.category"
                size="small"
                @click="emit('open-template', tpl)"
              >
                新建{{ tpl.label }}
              </el-button>
            </div>
          </template>
        </el-alert>

        <el-card shadow="never" class="template-card">
          <template #header>
            <div class="template-head">
              <strong>快速建档模板</strong>
              <span class="template-sub">先把关键件、外协、标准件供应商建起来，后续采购跟催和质量评分才有主线。</span>
            </div>
          </template>
          <div class="template-grid">
            <div v-for="tpl in supplierSetup.bootstrap_templates || []" :key="tpl.category" class="template-item">
              <div class="template-title">{{ tpl.label }}</div>
              <div class="template-desc">{{ tpl.category_notes }}</div>
              <div class="template-status">
                <el-tag :type="tpl.exists ? 'success' : 'warning'" size="small">{{ tpl.exists ? '已覆盖' : '待建档' }}</el-tag>
              </div>
              <el-button size="small" :disabled="tpl.exists" @click="emit('open-template', tpl)">套用模板</el-button>
            </div>
          </div>
        </el-card>
        <div class="tb">
          <el-select v-model="supplierFilter.category" clearable placeholder="供应商分类" style="width: 180px" @change="emit('load-suppliers')">
            <el-option v-for="c in supplierCategories" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
          <el-button type="primary" @click="emit('open-dialog')">+ 新增供应商</el-button>
        </div>
        <el-table :data="suppliers" v-loading="sLoading" size="small" max-height="500" stripe>
          <el-table-column label="名称" min-width="160"><template #default="{ row }">{{ supplierName(row) }}</template></el-table-column>
          <el-table-column label="分类" width="130">
            <template #default="{ row }">
              <el-tag size="small" :type="supplierCategoryTag(row.supplier_category)">{{ row.supplier_category_label || supplierCategoryLabel(row.supplier_category) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="业务类型" min-width="170">
            <template #default="{ row }">
              <el-tag v-for="label in row.business_category_labels || []" :key="label" size="small" style="margin:1px">{{ label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="联系人" width="100"><template #default="{ row }">{{ row.contact_person || row.contact || "-" }}</template></el-table-column>
          <el-table-column prop="phone" label="电话" width="130" />
          <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
          <el-table-column label="评级" width="120">
            <template #default="{ row }">
              <el-tag size="small" type="warning">{{ row.rating || "B" }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="(row.is_active ?? (row.status === 'active')) ? 'success' : 'info'" size="small">{{ (row.is_active ?? (row.status === 'active')) ? '启用' : '停用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="emit('open-dialog', row)">编辑</el-button>
              <el-button size="small" link type="danger" @click="emit('delete-supplier', row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- Supplier Add/Edit Dialog -->
        <el-dialog v-model="supplierDlg.visible" :title="supplierDlg.isEdit ? '编辑供应商' : '新增供应商'" width="500px" @closed="emit('reset-form')">
          <el-form :model="supplierForm" label-width="80px">
            <el-form-item label="编码" required><el-input v-model="supplierForm.supplier_code" placeholder="SUP-001" :disabled="supplierDlg.isEdit" /></el-form-item>
            <el-form-item label="名称" required><el-input v-model="supplierForm.supplier_name" placeholder="供应商名称" /></el-form-item>
            <el-form-item label="主分类" required>
              <el-select v-model="supplierForm.supplier_category" style="width:100%" @change="emit('sync-category')">
                <el-option v-for="c in supplierCategories" :key="c.value" :label="c.label" :value="c.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="业务分类">
              <el-select v-model="supplierForm.business_categories" multiple style="width:100%">
                <el-option v-for="c in supplierCategories" :key="c.value" :label="c.label" :value="c.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="联系人"><el-input v-model="supplierForm.contact_person" placeholder="联系人" /></el-form-item>
            <el-form-item label="电话"><el-input v-model="supplierForm.phone" placeholder="电话" /></el-form-item>
            <el-form-item label="邮箱"><el-input v-model="supplierForm.email" placeholder="邮箱" /></el-form-item>
            <el-form-item label="地址"><el-input v-model="supplierForm.address" placeholder="地址" /></el-form-item>
            <el-form-item label="评级"><el-select v-model="supplierForm.rating" style="width:100%"><el-option label="A级 优先" value="A" /><el-option label="B级 合格" value="B" /><el-option label="C级 观察" value="C" /><el-option label="D级 禁用" value="D" /></el-select></el-form-item>
            <el-form-item label="付款条款"><el-input v-model="supplierForm.payment_terms" placeholder="月结30天/预付30%" /></el-form-item>
            <el-form-item label="分类说明"><el-input v-model="supplierForm.category_notes" placeholder="关键件范围/外协工序/标准件品类" /></el-form-item>
            <el-form-item label="状态">
              <el-select v-model="supplierForm.status" style="width:100%">
                <el-option label="启用" value="active" />
                <el-option label="停用" value="inactive" />
              </el-select>
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="supplierDlg.visible = false">取消</el-button>
            <el-button type="primary" @click="emit('save-supplier')" :loading="saving">保存</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>
</template>


<script setup lang="ts">
defineProps<{
  supplierSetup: any
  missingTemplates: any[]
  supplierFilter: any
  supplierCategories: any[]
  suppliers: any[]
  sLoading: boolean
  supplierDlg: any
  supplierForm: any
  saving: boolean
  supplierName: (row: any) => string
  supplierCategoryLabel: (value: string) => string
  supplierCategoryTag: (value: string) => string
  supplierSetupCount: (category: string) => number
}>()

const emit = defineEmits<{
  (event: 'load-suppliers'): void
  (event: 'bootstrap-defaults'): void
  (event: 'open-template', template: any): void
  (event: 'open-dialog', row?: any): void
  (event: 'delete-supplier', row: any): void
  (event: 'reset-form'): void
  (event: 'sync-category'): void
  (event: 'save-supplier'): void
}>()
</script>


<style scoped>
.tb { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.setup-row { margin-bottom: 12px; }
.setup-card { min-height: 96px; }
.setup-label { color: var(--el-text-color-secondary); font-size: 12px; }
.setup-value { font-size: 28px; font-weight: 700; margin-top: 8px; }
.setup-sub { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 6px; }
.supplier-alert { margin-bottom: 12px; }
.template-card { margin-bottom: 12px; }
.template-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
.template-sub { color: var(--el-text-color-secondary); font-size: 12px; }
.template-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.template-item { border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 12px; background: var(--el-fill-color-blank); }
.template-title { font-weight: 700; margin-bottom: 6px; }
.template-desc { color: var(--el-text-color-secondary); font-size: 12px; min-height: 40px; line-height: 1.5; }
.template-status { margin: 10px 0; }
</style>
