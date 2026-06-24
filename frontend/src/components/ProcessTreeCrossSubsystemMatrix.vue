<template>
  <div class="xsub-matrix">
    <div class="xsub-header" @click="expanded = !expanded">
      <span class="xsub-toggle">{{ expanded ? '▼' : '▶' }}</span>
      <span class="xsub-title">跨子系统依赖矩阵</span>
      <span class="xsub-hint">{{ hint }}</span>
      <el-button
        v-if="expanded"
        size="small"
        text
        @click.stop="loadMatrix"
        :loading="loading"
      >刷新</el-button>
    </div>

    <transition name="xsub-fade">
      <div v-if="expanded" class="xsub-body">
        <el-skeleton v-if="loading && !data" :rows="4" animated />

        <template v-else-if="data">
          <!-- Summary row -->
          <div class="xsub-summary">
            <div class="xsub-stat">
              <span class="xsub-stat-value">{{ data.summary.total_edges }}</span>
              <span class="xsub-stat-label">总依赖边</span>
            </div>
            <div class="xsub-stat">
              <span class="xsub-stat-value xsub-stat-intra">{{ data.summary.intra_subsystem_edges }}</span>
              <span class="xsub-stat-label">子系统内</span>
            </div>
            <div class="xsub-stat">
              <span class="xsub-stat-value xsub-stat-inter">{{ data.summary.inter_subsystem_edges }}</span>
              <span class="xsub-stat-label">跨子系统</span>
            </div>
            <div class="xsub-stat">
              <span class="xsub-stat-value">{{ data.subsystems.length }}</span>
              <span class="xsub-stat-label">子系统</span>
            </div>
          </div>

          <!-- Matrix grid -->
          <div class="xsub-grid-wrap">
            <table class="xsub-grid">
              <thead>
                <tr>
                  <th class="xsub-corner"></th>
                  <th
                    v-for="(sub, j) in data.subsystems"
                    :key="sub.key"
                    class="xsub-col-head"
                    :title="sub.name_en"
                  >
                    <div class="xsub-col-inner">
                      <div class="xsub-color-dot" :style="{ background: sub.color }"></div>
                      <div class="xsub-col-name">{{ sub.name }}</div>
                      <div class="xsub-col-count">{{ sub.node_count }}</div>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(subI, i) in data.subsystems" :key="subI.key">
                  <th class="xsub-row-head" :title="subI.name_en">
                    <div class="xsub-row-inner">
                      <div class="xsub-color-dot" :style="{ background: subI.color }"></div>
                      <div class="xsub-row-name">{{ subI.name }}</div>
                      <div class="xsub-row-count">{{ subI.node_count }}</div>
                    </div>
                  </th>
                  <td
                    v-for="(subJ, j) in data.subsystems"
                    :key="subJ.key"
                    class="xsub-cell"
                    :class="cellClass(i, j, data.matrix[i][j])"
                    :title="cellTitle(i, j, data.matrix[i][j])"
                  >
                    <template v-if="data.matrix[i][j].count > 0">
                      <div class="xsub-cell-count">{{ data.matrix[i][j].count }}</div>
                      <div class="xsub-cell-weight">{{ data.matrix[i][j].weight }}</div>
                    </template>
                    <template v-else>
                      <div class="xsub-cell-empty">·</div>
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Coupling lists -->
          <div class="xsub-coupling">
            <div class="xsub-coupling-block">
              <div class="xsub-coupling-title">🔗 最强耦合</div>
              <div v-if="data.summary.strongest_coupling.length === 0" class="xsub-coupling-empty">
                无跨子系统依赖（所有依赖均位于同一子系统内部）
              </div>
              <ol v-else class="xsub-coupling-list">
                <li v-for="(c, i) in data.summary.strongest_coupling" :key="i">
                  <span class="xsub-coupling-pair">{{ subName(c.from) }} → {{ subName(c.to) }}</span>
                  <span class="xsub-coupling-weight">权重 {{ c.weight }}</span>
                </li>
              </ol>
            </div>
            <div class="xsub-coupling-block">
              <div class="xsub-coupling-title">🕳️ 最弱耦合（无边的子系统对）</div>
              <ul v-if="data.summary.weakest_coupling.length > 0" class="xsub-coupling-list">
                <li v-for="(c, i) in data.summary.weakest_coupling" :key="i">
                  <span class="xsub-coupling-pair">{{ subName(c.from) }} ⇢ {{ subName(c.to) }}</span>
                  <span class="xsub-coupling-weight">无依赖</span>
                </li>
              </ul>
              <div v-else class="xsub-coupling-empty">所有子系统对均存在依赖</div>
            </div>
          </div>

          <div class="xsub-foot">
            <span class="xsub-foot-tip">
              💡 颜色深浅 = 权重（节点对数 × 依赖类型系数）。
              对角线 = 子系统内部依赖；非对角线 = 跨子系统集成边界。
              强耦合对 = 拆分风险点；最弱耦合对 = 潜在子系统拆分候选。
            </span>
          </div>
        </template>

        <el-empty v-else description="暂无数据" :image-size="60" />
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  instanceId: { type: Number, required: true },
});

function authHeader() {
  return { Authorization: 'Bearer ' + (localStorage.getItem('tbm_token') || '') };
}

const expanded = ref(false);
const data = ref(null);
const loading = ref(false);
const error = ref(null);

const hint = computed(() => {
  if (!data.value) return '点击展开跨子系统依赖分析';
  const s = data.value.summary;
  return `${s.total_edges} 边 · ${s.inter_subsystem_edges} 跨子系统 · ${s.intra_subsystem_edges} 内部`;
});

const subMap = computed(() => {
  if (!data.value) return {};
  const m = {};
  for (const s of data.value.subsystems) m[s.key] = s;
  return m;
});

function subName(key) {
  return subMap.value[key]?.name || key;
}

function cellClass(i, j, cell) {
  if (i === j) return 'xsub-cell-diagonal';
  if (cell.count > 0) return 'xsub-cell-inter';
  return 'xsub-cell-empty';
}

function cellTitle(i, j, cell) {
  if (cell.count === 0) return '无依赖';
  const from = data.value.subsystems[i]?.name || `sub ${i}`;
  const to = data.value.subsystems[j]?.name || `sub ${j}`;
  const edgeList = cell.edges.slice(0, 5).map((e) => `  ${e.from} → ${e.to} (${e.type})`).join('\n');
  const more = cell.edges.length > 5 ? `\n  ... 还有 ${cell.edges.length - 5} 条` : '';
  return `${from} → ${to}\n边数: ${cell.count}，权重: ${cell.weight}\n${edgeList}${more}`;
}

async function loadMatrix() {
  loading.value = true;
  error.value = null;
  try {
    const r = await fetch(
      `/api/equipment_instances/${props.instanceId}/cross_subsystem_deps`,
      { headers: authHeader() }
    );
    if (!r.ok) throw new Error('HTTP ' + r.status);
    data.value = await r.json();
  } catch (e) {
    error.value = e.message || String(e);
    data.value = null;
    console.error('cross_subsystem_deps load error', e);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.instanceId,
  () => {
    data.value = null;
    if (expanded.value) loadMatrix();
  }
);

watch(expanded, (v) => {
  if (v && !data.value && !loading.value) loadMatrix();
});
</script>

<style scoped>
.xsub-matrix {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
  margin-bottom: 16px;
  overflow: hidden;
}
.xsub-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  cursor: pointer;
  user-select: none;
}
.xsub-header:hover { background: var(--el-fill-color); }
.xsub-toggle {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  width: 12px;
}
.xsub-title {
  font-weight: 600;
  font-size: 14px;
}
.xsub-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  flex: 1;
}
.xsub-fade-enter-active, .xsub-fade-leave-active {
  transition: opacity 0.15s ease;
}
.xsub-fade-enter-from, .xsub-fade-leave-to { opacity: 0; }
.xsub-body { padding: 16px; }

.xsub-summary {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.xsub-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 16px;
  border-radius: 4px;
  background: var(--el-fill-color-lightest);
  min-width: 80px;
}
.xsub-stat-value {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.2;
}
.xsub-stat-intra { color: var(--el-color-info); }
.xsub-stat-inter { color: var(--el-color-warning); }
.xsub-stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.xsub-grid-wrap {
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  margin-bottom: 16px;
}
.xsub-grid {
  border-collapse: collapse;
  font-size: 12px;
}
.xsub-corner {
  background: var(--el-fill-color-light);
  position: sticky;
  top: 0;
  left: 0;
  z-index: 3;
  min-width: 110px;
  max-width: 110px;
}
.xsub-col-head {
  background: var(--el-fill-color-light);
  position: sticky;
  top: 0;
  z-index: 2;
  min-width: 80px;
  padding: 4px 6px !important;
  text-align: center;
  vertical-align: bottom;
  font-weight: normal;
}
.xsub-row-head {
  background: var(--el-fill-color-light);
  position: sticky;
  left: 0;
  z-index: 1;
  text-align: left;
  padding: 4px 8px !important;
  min-width: 110px;
  max-width: 110px;
}
.xsub-col-inner, .xsub-row-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.xsub-row-inner { align-items: flex-start; }
.xsub-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.xsub-col-name, .xsub-row-name {
  font-weight: 500;
  font-size: 12px;
  white-space: nowrap;
}
.xsub-col-count, .xsub-row-count {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
.xsub-cell {
  border: 1px solid var(--el-border-color-lighter);
  text-align: center;
  vertical-align: middle;
  padding: 4px;
  min-width: 56px;
  height: 42px;
  transition: filter 0.1s ease;
}
.xsub-cell:hover { filter: brightness(1.15); cursor: default; }
.xsub-cell-count {
  font-weight: 600;
  font-size: 13px;
}
.xsub-cell-weight {
  font-size: 10px;
  color: var(--el-text-color-secondary);
}
.xsub-cell-empty {
  color: var(--el-text-color-placeholder);
}
.xsub-cell-diagonal {
  background: rgba(59, 130, 246, 0.10);
}
/* Heat-map: stronger inter-subsystem weights get warmer colours. */
.xsub-cell-inter {
  /* background inline-style set per-cell via :style would be nicer; keep
     classes here as a baseline that gets overridden by inline heatmap. */
  background: rgba(245, 158, 11, 0.18);
}

.xsub-coupling {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}
@media (max-width: 768px) {
  .xsub-coupling { grid-template-columns: 1fr; }
}
.xsub-coupling-block {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 12px;
}
.xsub-coupling-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 8px;
}
.xsub-coupling-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
}
.xsub-coupling-list li {
  padding: 3px 0;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.xsub-coupling-pair {
  font-weight: 500;
}
.xsub-coupling-weight {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.xsub-coupling-empty {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-style: italic;
}
.xsub-foot {
  border-top: 1px dashed var(--el-border-color-lighter);
  padding-top: 8px;
}
.xsub-foot-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
</style>
