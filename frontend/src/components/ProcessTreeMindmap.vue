<template>
  <div class="mindmap">
    <div class="mindmap-header" @click="expanded = !expanded">
      <span class="mindmap-toggle">{{ expanded ? '▼' : '▶' }}</span>
      <span class="mindmap-title"><el-icon><MagicStick /></el-icon> 思维导图视图</span>
      <span class="mindmap-hint">{{ hint }}</span>
      <el-button
        v-if="expanded"
        size="small"
        text
        @click.stop="loadCurrent(true)"
        :loading="loading"
      >刷新</el-button>
    </div>

    <transition name="mindmap-fade">
      <div v-if="expanded" class="mindmap-body">
        <!-- 加载 / 错误 / 空状态 -->
        <el-skeleton v-if="loading && !tree" :rows="3" animated />
        <el-empty v-else-if="error" :description="error" />
        <el-empty v-else-if="!tree" description="无数据" />

        <template v-else>
          <!-- 面包屑导航（可点击回溯） -->
          <div v-if="breadcrumb.length > 1" class="mindmap-breadcrumb">
            <span
              v-for="(crumb, i) in breadcrumb"
              :key="crumb.part_id"
              class="mindmap-crumb"
              :class="{ 'mindmap-crumb-current': i === breadcrumb.length - 1 }"
              @click="onCrumbClick(crumb.part_id)"
            >
              <span class="mindmap-crumb-icon">{{ levelIcon(crumb.level) }}</span>
              <span class="mindmap-crumb-name">{{ crumb.name }}</span>
              <span v-if="i < breadcrumb.length - 1" class="mindmap-crumb-sep">›</span>
            </span>
          </div>

          <!-- 顶部 KPI 卡片 -->
          <div class="mindmap-kpi">
            <div class="mindmap-stat">
              <span class="mindmap-stat-value">{{ tree.current.total_nodes }}</span>
              <span class="mindmap-stat-label">总节点</span>
            </div>
            <div class="mindmap-stat">
              <span class="mindmap-stat-value mindmap-stat-done">{{ tree.current.completed_nodes }}</span>
              <span class="mindmap-stat-label">已完成</span>
            </div>
            <div class="mindmap-stat">
              <span class="mindmap-stat-value mindmap-stat-doing">{{ tree.current.in_progress_nodes }}</span>
              <span class="mindmap-stat-label">进行中</span>
            </div>
            <div class="mindmap-stat">
              <span class="mindmap-stat-value">{{ tree.current.child_count }}</span>
              <span class="mindmap-stat-label">下层节点</span>
            </div>
            <div class="mindmap-stat">
              <span class="mindmap-stat-value mindmap-stat-pct">{{ tree.current.progress_pct }}%</span>
              <span class="mindmap-stat-label">进度</span>
            </div>
          </div>

          <!-- 中心节点 + 径向布局图 -->
          <div ref="chartEl" class="mindmap-chart"></div>

          <!-- 操作按钮 -->
          <div class="mindmap-actions">
            <el-button
              size="small"
              type="primary"
              @click="onCenterClick"
              :disabled="breadcrumb.length === 0"
            >
              {{ tree.current.kind === 'root' ? '回到总览' : '回到当前层中心' }}
            </el-button>
            <el-button size="small" @click="loadCurrent(true)" :loading="loading">重新加载</el-button>
          </div>

          <!-- 子节点列表（点击进入下层） -->
          <div v-if="tree.children && tree.children.length > 0" class="mindmap-children">
            <div class="mindmap-children-title">
              {{ levelTitle(tree.current.level) }} · 共 {{ tree.children.length }} 项
              <span class="mindmap-hint-tiny">· hover 看详情</span>
            </div>
            <div class="mindmap-child-grid">
              <el-tooltip
                v-for="child in tree.children"
                :key="child.part_id"
                placement="top"
                :show-after="200"
                :hide-after="50"
                popper-class="mindmap-tooltip-pop"
              >
                <template #content>
                  <div class="mindmap-tooltip">
                    <div class="mindmap-tooltip-title">
                      <span class="mindmap-tooltip-icon">{{ kindIcon(child.kind) }}</span>
                      <span class="mindmap-tooltip-name">{{ child.name }}</span>
                      <span v-if="child.name_en" class="mindmap-tooltip-en">{{ child.name_en }}</span>
                    </div>
                    <div class="mindmap-tooltip-row"><span class="mindmap-tooltip-key">类型</span><span class="mindmap-tooltip-val">{{ kindLabel(child.kind) }} · L{{ child.level }}</span></div>
                    <div v-if="child.subsystem_id" class="mindmap-tooltip-row"><span class="mindmap-tooltip-key">子系统</span><span class="mindmap-tooltip-val">#{{ child.subsystem_id }}</span></div>
                    <div v-if="child.bom_node_id" class="mindmap-tooltip-row"><span class="mindmap-tooltip-key">BOM 节点</span><span class="mindmap-tooltip-val">#{{ child.bom_node_id }}</span></div>
                    <div v-if="child.sequence !== undefined" class="mindmap-tooltip-row"><span class="mindmap-tooltip-key">排序</span><span class="mindmap-tooltip-val">{{ child.sequence }}</span></div>
                    <div v-if="child.child_count !== undefined" class="mindmap-tooltip-row"><span class="mindmap-tooltip-key">下层</span><span class="mindmap-tooltip-val">{{ child.child_count }} 子项</span></div>
                    <div v-if="child.op_count !== undefined" class="mindmap-tooltip-row"><span class="mindmap-tooltip-key">工序</span><span class="mindmap-tooltip-val">{{ child.op_count }} 道</span></div>
                    <div v-if="child.progress_pct !== undefined" class="mindmap-tooltip-row"><span class="mindmap-tooltip-key">进度</span><span class="mindmap-tooltip-val" :class="progressClass(child)">{{ child.progress_pct }}%</span></div>
                    <div v-if="child.status" class="mindmap-tooltip-row"><span class="mindmap-tooltip-key">状态</span><span class="mindmap-tooltip-val">{{ statusLabel(child.status) }}</span></div>
                    <div v-if="child.estimated_hours !== undefined && child.estimated_hours !== null" class="mindmap-tooltip-row"><span class="mindmap-tooltip-key">工时</span><span class="mindmap-tooltip-val">{{ child.estimated_hours }} h</span></div>
                    <div v-if="child.required_workstation_id" class="mindmap-tooltip-row"><span class="mindmap-tooltip-key">工位</span><span class="mindmap-tooltip-val">#{{ child.required_workstation_id }}</span></div>
                    <div v-if="child.material_name && child.material_name !== child.name" class="mindmap-tooltip-row"><span class="mindmap-tooltip-key">物料</span><span class="mindmap-tooltip-val">{{ child.material_name }}</span></div>
                    <div v-if="child.notes" class="mindmap-tooltip-row mindmap-tooltip-row-notes"><span class="mindmap-tooltip-key">备注</span><span class="mindmap-tooltip-val">{{ child.notes }}</span></div>
                    <div class="mindmap-tooltip-hint">点击进入下层 →</div>
                  </div>
                </template>
                <div
                  class="mindmap-child-card"
                  :class="'mindmap-child-' + child.kind"
                  @click="onChildClick(child)"
                >
                  <div class="mindmap-child-icon">{{ kindIcon(child.kind) }}</div>
                  <div class="mindmap-child-info">
                    <div class="mindmap-child-name">{{ child.name }}</div>
                    <div class="mindmap-child-meta">
                      <span v-if="child.child_count !== undefined" class="mindmap-child-tag">
                        {{ child.child_count }} 子项
                      </span>
                      <span v-if="child.op_count !== undefined" class="mindmap-child-tag mindmap-child-tag-op">
                        {{ child.op_count }} 工序
                      </span>
                      <span v-if="child.progress_pct !== undefined" class="mindmap-child-tag" :class="progressClass(child)">
                        {{ child.progress_pct }}%
                      </span>
                      <span v-if="child.status" class="mindmap-child-tag" :class="'mindmap-child-status-' + child.status">
                        {{ statusLabel(child.status) }}
                      </span>
                    </div>
                  </div>
                  <div class="mindmap-child-arrow">›</div>
                </div>
              </el-tooltip>
            </div>
          </div>
        </template>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { useProcessTreeMindmap } from '../composables/useProcessTreeMindmap'
import './ProcessTreeMindmap.css'

const props = defineProps({
  instanceId: { type: Number, required: true },
  initialPartId: { type: String, default: 'root' },
})

const emit = defineEmits(['navigate'])

const {
  expanded,
  tree,
  breadcrumb,
  loading,
  error,
  chartEl,
  hint,
  levelIcon,
  kindIcon,
  kindLabel,
  levelTitle,
  statusLabel,
  progressClass,
  loadCurrent,
  onChildClick,
  onCrumbClick,
  onCenterClick,
} = useProcessTreeMindmap(props, emit)
</script>


