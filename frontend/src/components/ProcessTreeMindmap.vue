<template>
  <div class="mindmap">
    <div class="mindmap-header" @click="expanded = !expanded">
      <span class="mindmap-toggle">{{ expanded ? '▼' : '▶' }}</span>
      <span class="mindmap-title">🧠 思维导图视图</span>
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
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import * as echarts from 'echarts/core';
import { GraphChart } from 'echarts/charts';
import { TitleComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([GraphChart, TitleComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const props = defineProps({
  instanceId: { type: Number, required: true },
  initialPartId: { type: String, default: 'root' },
});

const emit = defineEmits(['navigate']);

function authHeader() {
  return { Authorization: 'Bearer ' + (localStorage.getItem('tbm_token') || '') };
}

const expanded = ref(true);  // 默认展开（思维导图是主视图）
const tree = ref(null);
const breadcrumb = ref([]);
const loading = ref(false);
const error = ref(null);

const chartEl = ref(null);
let chart = null;

const currentPartId = ref(props.initialPartId || 'root');

const hint = computed(() => {
  if (!tree.value) return '点击展开工艺树思维导图';
  const c = tree.value.current;
  return `${c.name} · L${c.level} · ${c.child_count} 子项 · ${c.progress_pct}%`;
});

const levelIcon = (level) => {
  if (level === 1) return '🏭';
  if (level === 2) return '⚙️';
  if (level === 3) return '🔧';
  if (level === 4) return '📋';
  return '•';
};

const kindIcon = (kind) => {
  if (kind === 'root') return '🏭';
  if (kind === 'subsystem') return '⚙️';
  if (kind === 'part') return '🔧';
  if (kind === 'operation') return '📋';
  return '•';
};

const kindLabel = (kind) => {
  return { root: '总装', subsystem: '子系统', part: '零件', operation: '工序', edge: '依赖' }[kind] || kind;
};

const levelTitle = (level) => {
  if (level === 1) return '总装层';
  if (level === 2) return '子系统层';
  if (level === 3) return '零件层';
  if (level === 4) return '工序层';
  return '其他';
};

const statusLabel = (s) => {
  return { pending: '待开始', ready: '就绪', in_progress: '进行中', completed: '已完成', blocked: '阻塞' }[s] || s;
};

const progressClass = (c) => {
  if (c.progress_pct >= 100) return 'mindmap-child-tag-done';
  if (c.progress_pct > 0) return 'mindmap-child-tag-doing';
  return 'mindmap-child-tag-pending';
};

async function loadCurrent(scrollToChart = false) {
  loading.value = true;
  error.value = null;
  try {
    // 并发：tree + breadcrumb
    const [treeRes, crumbRes] = await Promise.all([
      fetch(`/api/equipment_instances/${props.instanceId}/parts_tree?part_id=${currentPartId.value}`, { headers: authHeader() }),
      fetch(`/api/equipment_instances/${props.instanceId}/parts_tree/path?part_id=${currentPartId.value}`, { headers: authHeader() }),
    ]);
    if (!treeRes.ok) {
      const errBody = await treeRes.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP ${treeRes.status}`);
    }
    if (!crumbRes.ok) {
      const errBody = await crumbRes.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP ${crumbRes.status}`);
    }
    tree.value = await treeRes.json();
    breadcrumb.value = (await crumbRes.json()).breadcrumb || [];

    await nextTick();
    try {
      renderChart();
    } catch (e) {
      console.error('[mindmap] renderChart failed:', e);
    }
    if (scrollToChart && chartEl.value) {
      chartEl.value.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (e) {
    error.value = e.message || String(e);
    tree.value = null;
    console.error('mindmap load error', e);
  } finally {
    loading.value = false;
  }
}

function buildChartOption() {
  if (!tree.value) return {};

  const c = tree.value.current;
  const centerColor = kindColor(c.kind);
  const centerNode = {
    id: c.part_id,
    name: c.name,
    symbolSize: kindSize(c.kind),
    itemStyle: { color: centerColor, borderColor: '#fff', borderWidth: 2 },
    label: { show: true, fontSize: 14, fontWeight: 600, color: '#fff', position: 'right' },
    category: 0,
  };

  const childNodes = (tree.value.children || []).filter((ch) => ch.kind !== 'edge');
  // 树状横向布局：中心节点在左，子节点按 sequence 排序后自上而下排在右侧
  // x: 中心固定 80，子节点 360（间距按容器自适应）
  // y: 中心垂直居中，子节点均匀分布
  const chartH = 420;  // 与 CSS .mindmap-chart height 一致
  const centerX = 100;
  const childX = 360;
  const n = childNodes.length;
  const vGap = n > 0 ? Math.min(60, Math.max(36, (chartH - 60) / Math.max(n, 1))) : 60;
  const totalH = n * vGap;
  const startY = (chartH - totalH) / 2;

  const children = childNodes.map((child, i) => ({
    id: child.part_id,
    name: child.name,
    symbolSize: kindSize(child.kind),
    x: childX,
    y: startY + vGap * (i + 0.5),
    fixed: true,  // 锁定位置，禁止 roam 拖动改变
    itemStyle: { color: kindColor(child.kind), borderColor: '#fff', borderWidth: 1 },
    label: {
      show: true,
      fontSize: child.kind === 'subsystem' ? 12 : 11,
      color: '#303133',
      position: child.kind === 'subsystem' ? 'right' : 'left',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: [2, 4],
      borderRadius: 2,
    },
    category: 1,
    progress_pct: child.progress_pct,
    status: child.status,
    value: child,  // 把原始 child 挂在节点上，click 时直接用
  }));

  const centerNodeWithPos = {
    ...centerNode,
    x: centerX,
    y: chartH / 2,
    fixed: true,
  };

  // 连线：中心 → 子（直线 + 圆角箭头）
  const links = children.map((ch) => ({
    source: tree.value.current.part_id,
    target: ch.id,
    lineStyle: { color: '#b1b3b8', width: 1.5, curveness: 0 },
    symbol: ['none', 'arrow'],
    symbolSize: 8,
  }));

  return {
    tooltip: {
      formatter: (p) => {
        if (p.dataType === 'node') {
          const ch = p.data.value;
          if (!ch) return `<b>${p.name}</b>`;
          const extra = ch.progress_pct !== undefined ? `<br/>进度: ${ch.progress_pct}%` : '';
          const st = ch.status ? `<br/>状态: ${statusLabel(ch.status)}` : '';
          const op = ch.op_count !== undefined ? `<br/>工序: ${ch.op_count} 道` : '';
          const sub = ch.child_count !== undefined ? `<br/>下层: ${ch.child_count} 子项` : '';
          return `<b>${p.name}</b>${extra}${st}${op}${sub}<br/><span style="color:#909399">点击进入下层</span>`;
        }
        return p.name;
      },
    },
    legend: [{ data: ['当前层', '下层'], top: 0, textStyle: { fontSize: 11 } }],
    series: [
      {
        type: 'graph',
        layout: 'none',  // 用我们手工算的 x/y
        roam: false,     // 树状布局下关闭 roam（避免破坏布局）
        draggable: false,
        categories: [{ name: '当前层', itemStyle: { color: centerColor } }, { name: '下层', itemStyle: { color: '#909399' } }],
        data: [centerNodeWithPos, ...children],
        links,
        emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 8,
      },
    ],
  };
}

function kindColor(kind) {
  return {
    root: '#f56c6c',
    subsystem: '#409eff',
    part: '#67c23a',
    operation: '#e6a23c',
    edge: '#909399',
  }[kind] || '#909399';
}

function kindSize(kind) {
  return { root: 80, subsystem: 50, part: 38, operation: 30, edge: 12 }[kind] || 30;
}

function renderChart() {
  if (!chartEl.value) return;
  if (!chart) {
    try {
      chart = echarts.init(chartEl.value, null, { renderer: 'canvas' });
    } catch (e) {
      console.error('[mindmap] echarts.init failed:', e);
      return;
    }
    // 用 part_id → kind 的 map 反查真实类型（避免按 category 误判）
    chart.on('click', (params) => {
      if (params.dataType !== 'node') return;
      const id = params.data.id;
      if (!id || id === tree.value?.current?.part_id) return;
      // 在 tree.children 里查找真实 kind
      const child = (tree.value?.children || []).find((c) => c.part_id === id);
      if (child) onChildClick(child);
    });
  }
  const opt = buildChartOption();
  if (opt && opt.series) {
    chart.setOption(opt, true);
  }
}

function onResize() {
  if (chart) chart.resize();
}

function onChildClick(child) {
  // 跳过 edge 节点（不是真节点）
  if (String(child.part_id).startsWith('edge_')) return;
  // 下钻：dispose 旧 chart 让下次 renderChart 重新 init（因为 chartEl.value 引用没变，但旧 zrender 状态需要重置）
  if (chart) {
    try { chart.dispose(); } catch (e) {}
    chart = null;
  }
  currentPartId.value = child.part_id;
  loadCurrent();
  emit('navigate', { part_id: child.part_id, name: child.name });
}

function onCrumbClick(partId) {
  currentPartId.value = partId;
  loadCurrent();
}

function onCenterClick() {
  if (currentPartId.value !== 'root') {
    currentPartId.value = 'root';
    loadCurrent();
  }
}

watch(
  () => props.instanceId,
  () => {
    // 切实例：必须 dispose 旧 chart + 重置 ref，避免新 chartEl 指向 detached DOM
    if (chart) {
      try { chart.dispose(); } catch (e) {}
      chart = null;
    }
    tree.value = null;
    breadcrumb.value = [];
    currentPartId.value = 'root';
    if (expanded.value) loadCurrent();
  }
);

watch(expanded, (v) => {
  if (v && !tree.value && !loading.value) loadCurrent();
  else if (v && tree.value) nextTick(renderChart);
});

onMounted(() => {
  window.addEventListener('resize', onResize);
  if (expanded.value) loadCurrent();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  if (chart) {
    chart.dispose();
    chart = null;
  }
});
</script>

<style scoped>
.mindmap {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 0;
  margin-bottom: 16px;
}

.mindmap-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  background: #fafbfc;
  border-bottom: 1px solid #ebeef5;
  border-radius: 6px 6px 0 0;
}

.mindmap-toggle {
  color: #909399;
  font-size: 12px;
  width: 14px;
  display: inline-block;
}

.mindmap-title {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
}

.mindmap-hint {
  margin-left: auto;
  font-size: 12px;
  color: #909399;
}

.mindmap-body {
  padding: 14px;
}

.mindmap-fade-enter-active,
.mindmap-fade-leave-active {
  transition: opacity 0.2s ease;
}

.mindmap-fade-enter-from,
.mindmap-fade-leave-to {
  opacity: 0;
}

/* 面包屑 */
.mindmap-breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 12px;
  font-size: 13px;
}

.mindmap-crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 3px;
  cursor: pointer;
  color: #409eff;
  transition: background 0.15s ease;
}

.mindmap-crumb:hover {
  background: #ecf5ff;
}

.mindmap-crumb-current {
  color: #303133;
  cursor: default;
  background: #fff;
  font-weight: 600;
}

.mindmap-crumb-current:hover {
  background: #fff;
}

.mindmap-crumb-icon {
  font-size: 12px;
}

.mindmap-crumb-sep {
  color: #c0c4cc;
  margin-left: 4px;
}

/* KPI */
.mindmap-kpi {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.mindmap-stat {
  flex: 1 1 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 14px;
  background: #f5f7fa;
  border-radius: 4px;
  border-left: 3px solid #dcdfe6;
}

.mindmap-stat-value {
  font-size: 20px;
  font-weight: 700;
  color: #303133;
  line-height: 1.2;
}

.mindmap-stat-done { color: #67c23a; }
.mindmap-stat-doing { color: #e6a23c; }
.mindmap-stat-pct { color: #409eff; }

.mindmap-stat-label {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
}

/* 图区域 */
.mindmap-chart {
  width: 100%;
  height: 420px;
  background: #fafbfc;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  margin-bottom: 12px;
}

/* 操作按钮 */
.mindmap-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

/* 子节点卡片网格 */
.mindmap-children {
  border-top: 1px dashed #ebeef5;
  padding-top: 12px;
}

.mindmap-children-title {
  font-size: 12px;
  color: #606266;
  font-weight: 600;
  margin-bottom: 8px;
}

.mindmap-child-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px;
}

.mindmap-child-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mindmap-child-card:hover {
  border-color: #409eff;
  background: #ecf5ff;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(64, 158, 255, 0.15);
}

.mindmap-child-icon {
  font-size: 22px;
  width: 32px;
  text-align: center;
  flex-shrink: 0;
}

.mindmap-child-info {
  flex: 1;
  min-width: 0;
}

.mindmap-child-name {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mindmap-child-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.mindmap-child-tag {
  display: inline-block;
  padding: 1px 6px;
  font-size: 10px;
  border-radius: 2px;
  background: #f0f2f5;
  color: #606266;
}

.mindmap-child-tag-op { background: #fdf6ec; color: #e6a23c; }
.mindmap-child-tag-done { background: #f0f9eb; color: #67c23a; }
.mindmap-child-tag-doing { background: #fdf6ec; color: #e6a23c; }
.mindmap-child-tag-pending { background: #f4f4f5; color: #909399; }

.mindmap-child-status-pending { background: #f4f4f5; color: #909399; }
.mindmap-child-status-ready { background: #ecf5ff; color: #409eff; }
.mindmap-child-status-in_progress { background: #fdf6ec; color: #e6a23c; }
.mindmap-child-status-completed { background: #f0f9eb; color: #67c23a; }
.mindmap-child-status-blocked { background: #fef0f0; color: #f56c6c; }

.mindmap-child-arrow {
  color: #c0c4cc;
  font-size: 18px;
  flex-shrink: 0;
}

.mindmap-child-card:hover .mindmap-child-arrow {
  color: #409eff;
}

.mindmap-hint-tiny {
  margin-left: 6px;
  font-size: 11px;
  color: #c0c4cc;
  font-weight: normal;
}

/* tooltip 内容样式（渲染在 popper 内，scoped 不会生效，需用 :global 或放在非 scoped） */
.mindmap-tooltip {
  font-size: 12px;
  line-height: 1.5;
  max-width: 320px;
}

.mindmap-tooltip-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
}

.mindmap-tooltip-icon {
  font-size: 14px;
}

.mindmap-tooltip-name {
  font-weight: 600;
  color: #fff;
  font-size: 13px;
}

.mindmap-tooltip-en {
  color: #c0c4cc;
  font-size: 11px;
  font-style: italic;
}

.mindmap-tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 2px;
}

.mindmap-tooltip-key {
  color: #c0c4cc;
  flex-shrink: 0;
}

.mindmap-tooltip-val {
  color: #fff;
  text-align: right;
  word-break: break-word;
}

.mindmap-tooltip-row-notes .mindmap-tooltip-val {
  text-align: left;
  flex: 1;
}

.mindmap-tooltip-hint {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  color: #409eff;
  font-size: 11px;
  text-align: center;
}
</style>

<style>
/* Element Plus tooltip popper 全局样式（scoped 不生效） */
.mindmap-tooltip-pop.el-popper {
  background: #303133 !important;
  color: #fff !important;
  border: none !important;
  padding: 8px 10px !important;
  max-width: 360px;
}
.mindmap-tooltip-pop.el-popper .el-popper__arrow::before {
  background: #303133 !important;
  border-color: #303133 !important;
}
</style>
