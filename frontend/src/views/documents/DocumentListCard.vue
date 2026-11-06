<template>
  <el-card shadow="never">
    <PageState
      v-if="loadError"
      state="error"
      title="文档列表加载失败"
      :description="loadError"
      action-text="重新加载"
      @retry="$emit('refresh')"
    />
    <PageState
      v-else-if="loading && !items.length"
      state="loading"
      title="正在加载文档/图纸"
      description="正在获取图纸、SOP、工艺文件和签发状态。"
    />
    <PageState
      v-else-if="!loading && !items.length"
      state="empty"
      title="暂无文档"
      description="当前筛选条件下没有文档，可重置筛选或上传新图纸/SOP。"
      action-text="重新查询"
      @retry="$emit('refresh')"
    >
      <template #actions>
        <el-button type="primary" :icon="UploadFilled" @click="$emit('upload')">上传新文档</el-button>
      </template>
    </PageState>
    <template v-else>
      <el-table :data="items" v-loading="loading" stripe size="small" @row-click="$emit('row-click')">
        <el-table-column label="" width="40">
          <template #default="{ row }"><span class="doc-icon">{{ row.icon }}</span></template>
        </el-table-column>
        <el-table-column prop="doc_code" label="编码" width="160" />
        <el-table-column prop="title" label="名称" min-width="200" show-overflow-tooltip />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ docTypeLabel[row.doc_type] || row.doc_type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="version" label="版本" width="60" />
        <el-table-column prop="human_size" label="大小" width="80" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTag[row.status]" size="small">{{ statusLabel[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="签发目标" width="100">
          <template #default="{ row }">
            <span v-if="row.issued_to">{{ issueTargetLabel[row.issued_to] || row.issued_to }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="关联" width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.instance_name" class="instance-link"><el-icon><Box /></el-icon> {{ row.instance_name }}</span>
            <span v-if="row.bom_part_number" class="bom-link"><el-icon><Tools /></el-icon> {{ row.bom_part_number }}</span>
            <span v-if="!row.instance_name && !row.bom_part_number" class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="created_at_alias" label="上传时间" width="160" />
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click.stop="$emit('preview', row)">预览</el-button>
            <el-button size="small" link @click.stop="$emit('download', row)">下载</el-button>
            <el-button v-if="row.status === 'issued'" size="small" link type="success" @click.stop="$emit('acknowledge', row)">签收</el-button>
            <el-button size="small" link type="info" @click.stop="$emit('load-acks', row)">签收记录</el-button>
            <el-button size="small" link type="primary" @click.stop="$emit('versions', row)">版本</el-button>
            <el-button v-if="row.status === 'draft'" size="small" link type="success" @click.stop="$emit('issue', row)">签发</el-button>
            <el-button v-if="row.status === 'issued'" size="small" link type="warning" @click.stop="$emit('revoke', row)">收回</el-button>
            <el-button v-if="row.status !== 'archived'" size="small" link type="danger" @click.stop="$emit('archive', row)">归档</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="currentPageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        class="pagination"
        @current-change="$emit('refresh')"
        @size-change="$emit('refresh')"
      />
    </template>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Box, Tools, UploadFilled } from '@element-plus/icons-vue'
import PageState from '../../components/PageState.vue'

const props = defineProps<{
  items: any[]
  loading: boolean
  loadError: string
  page: number
  pageSize: number
  total: number
  docTypeLabel: Record<string, string>
  statusLabel: Record<string, string>
  statusTag: Record<string, string>
  issueTargetLabel: Record<string, string>
}>()

const emit = defineEmits<{
  'update:page': [value: number]
  'update:pageSize': [value: number]
  refresh: []
  upload: []
  'row-click': []
  preview: [row: any]
  download: [row: any]
  acknowledge: [row: any]
  'load-acks': [row: any]
  versions: [row: any]
  issue: [row: any]
  revoke: [row: any]
  archive: [row: any]
}>()

const currentPage = computed({
  get: () => props.page,
  set: (value: number) => emit('update:page', value),
})

const currentPageSize = computed({
  get: () => props.pageSize,
  set: (value: number) => emit('update:pageSize', value),
})
</script>

<style scoped>
.doc-icon {
  font-size: 18px;
}

.muted {
  color: var(--el-text-color-placeholder);
}

.instance-link {
  color: var(--el-color-primary);
}

.bom-link {
  margin-left: 6px;
  color: var(--el-color-success);
}

.pagination {
  margin-top: 12px;
  justify-content: flex-end;
}
</style>
