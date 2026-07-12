<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title"><el-icon><Setting /></el-icon> 工艺参数监控 (MESA #8)</div>
      <div>
        <el-select v-model="selectedInstance" placeholder="选择装备实例" style="width: 240px; margin-right: 8px" @change="loadNodes">
          <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
        </el-select>
        <el-select v-model="selectedNode" placeholder="选择工艺节点" style="width: 240px; margin-right: 8px" @change="loadParams">
          <el-option v-for="n in nodes" :key="n.id" :label="n.name + ' (' + (n.node_type||'工序') + ')'" :value="n.id" />
        </el-select>
        <el-button type="primary" @click="loadParams" :loading="loading">查询</el-button>
        <el-button @click="openAdd" :disabled="!selectedNode">+ 记录参数</el-button>
      </div>
    </div>

    <div v-if="!selectedNode" style="text-align: center; padding: 40px">
      <el-empty description="选择装备实例和工艺节点查看参数" />
    </div>

    <div v-else v-loading="loading">
      <!-- MESA #8: 趋势图 -->
      <el-row :gutter="12" style="margin-bottom:16px">
        <el-col :span="12" v-for="p in trendParams" :key="p.key">
          <el-card shadow="never" style="margin-bottom:8px">
            <template #header><span style="font-weight:600">{{ p.label }}</span>
              <el-tag v-if="p.alerts" size="small" type="danger" style="margin-left:8px">{{ p.alerts }} 报警</el-tag>
            </template>
            <div :ref="(el:any) => setChartRef(p.key, el)" style="width:100%;height:180px"></div>
          </el-card>
        </el-col>
      </el-row>

      <!-- SPC 控制图链接 -->
      <el-card shadow="never" style="margin-bottom:12px" v-if="params.length >= 5">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-weight:600">SPC 分析:</span>
          <el-select v-model="spcParam" size="small" style="width:150px">
            <el-option v-for="p in trendParams" :key="p.key" :label="p.label" :value="p.key" />
          </el-select>
          <el-button size="small" type="primary" @click="runSpc" :loading="spcLoading">运行 SPC 分析</el-button>
          <span v-if="spcResult" style="font-size:13px">
            Cpk: <b :style="{color:spcResult.capability?.cpk >= 1.33 ? 'var(--el-color-success)' : spcResult.capability?.cpk >= 1.0 ? 'var(--el-color-warning)' : 'var(--el-color-danger)'}">{{ spcResult.capability?.cpk?.toFixed(2) || '—' }}</b>
            | PpK: <b>{{ spcResult.capability?.ppk?.toFixed(2) || '—' }}</b>
            | WECO: <b :style="{color:spcResult.weco_alerts?.length ? 'var(--el-color-danger)' : 'var(--el-color-success)'}">{{ spcResult.weco_alerts?.length || 0 }} 条</b>
          </span>
        </div>
      </el-card>

      <!-- 参数表格 -->
      <el-table :data="params" stripe size="small" max-height="400">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column label="电流(A)" width="90" align="right">
          <template #default="{row}">{{ row.current_amp != null ? row.current_amp : '-' }}</template>
        </el-table-column>
        <el-table-column label="电压(V)" width="90" align="right">
          <template #default="{row}">{{ row.voltage_v != null ? row.voltage_v : '-' }}</template>
        </el-table-column>
        <el-table-column label="速度(mm/min)" width="110" align="right">
          <template #default="{row}">{{ row.speed_mm_min != null ? row.speed_mm_min : '-' }}</template>
        </el-table-column>
        <el-table-column label="温度(°C)" width="100" align="right">
          <template #default="{row}">
            <span :style="{color: row.temperature_c != null && row.temperature_c > 300 ? 'var(--el-color-danger)' : ''}">{{ row.temperature_c != null ? row.temperature_c : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="压力(MPa)" width="100" align="right">
          <template #default="{row}">{{ row.pressure_mpa != null ? row.pressure_mpa : '-' }}</template>
        </el-table-column>
        <el-table-column label="进给率" width="90" align="right">
          <template #default="{row}">{{ row.feed_rate != null ? row.feed_rate : '-' }}</template>
        </el-table-column>
        <el-table-column prop="notes" label="备注" min-width="150" show-overflow-tooltip />
        <el-table-column prop="recorder_name" label="记录人" width="100" />
        <el-table-column prop="recorded_at" label="记录时间" width="170" />
      </el-table>
    </div>

    <!-- 新增参数弹窗 -->
    <el-dialog v-model="dlg.visible" title="记录工艺参数" width="500px">
      <el-form :model="dlg.form" label-width="110px">
        <el-form-item label="电流 (A)"><el-input v-model.number="dlg.form.current_amp" type="number" /></el-form-item>
        <el-form-item label="电压 (V)"><el-input v-model.number="dlg.form.voltage_v" type="number" /></el-form-item>
        <el-form-item label="速度 (mm/min)"><el-input v-model.number="dlg.form.speed_mm_min" type="number" /></el-form-item>
        <el-form-item label="温度 (°C)"><el-input v-model.number="dlg.form.temperature_c" type="number" /></el-form-item>
        <el-form-item label="压力 (MPa)"><el-input v-model.number="dlg.form.pressure_mpa" type="number" /></el-form-item>
        <el-form-item label="进给率"><el-input v-model.number="dlg.form.feed_rate" type="number" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="dlg.form.notes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" @click="saveParam" :loading="dlg.saving">记录</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from "vue";
import api from "../api";
import { ElMessage } from "element-plus";
import * as echarts from "echarts";

const instances = ref<any[]>([]);
const nodes = ref<any[]>([]);
const selectedInstance = ref<number | null>(null);
const selectedNode = ref<number | null>(null);
const params = ref<any[]>([]);
const loading = ref(false);
const dlg = reactive({ visible: false, saving: false, form: {} as any });

const spcParam = ref("temperature_c");
const spcLoading = ref(false);
const spcResult = ref<any>(null);

const chartRefs: Record<string, any> = {};
const chartInstances: Record<string, any> = {};

const trendParams = [
  { key: "current_amp", label: "电流 (A)" },
  { key: "voltage_v", label: "电压 (V)" },
  { key: "speed_mm_min", label: "速度 (mm/min)" },
  { key: "temperature_c", label: "温度 (°C)" },
  { key: "pressure_mpa", label: "压力 (MPa)" },
  { key: "feed_rate", label: "进给率" },
];

function setChartRef(key: string, el: any) {
  if (el) chartRefs[key] = el;
}

async function renderTrends() {
  if (!selectedNode.value) return;
  await nextTick();
  for (const p of trendParams) {
    const el = chartRefs[p.key];
    if (!el) continue;
    if (chartInstances[p.key]) chartInstances[p.key].dispose();
    try {
      const data = await api.get("/process_nodes/" + selectedNode.value + "/params/trend", { params: { param: p.key, limit: 80 } });
      if (!data.times || !data.values || data.values.length === 0) continue;
      const chart = echarts.init(el);
      chartInstances[p.key] = chart;
      chart.setOption({
        tooltip: { trigger: "axis" },
        grid: { top: 8, right: 16, bottom: 24, left: 48 },
        xAxis: { type: "category", data: data.times.map((t: string) => t.slice(11, 19)), axisLabel: { fontSize: 10 } },
        yAxis: { type: "value", name: p.label, nameTextStyle: { fontSize: 10 } },
        series: [{
          data: data.values,
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 1.5, color: "var(--el-color-primary)" },
          areaStyle: { color: "rgba(64,158,255,0.1)" },
          markLine: {
            silent: true,
            data: [
              { type: "average", name: "均值", lineStyle: { color: "var(--el-color-success)", type: "dashed" } },
            ],
          },
        }],
      });
    } catch (_e) {}
  }
}

async function loadInstances() {
  try { const r = await api.get("/equipment_instances"); instances.value = r.items || r || []; }
  catch (_) { ElMessage.error("加载实例失败"); }
}

async function loadNodes() {
  if (!selectedInstance.value) return;
  try {
    const r = await api.get("/equipment_instances/" + selectedInstance.value + "/process_tree");
    const flat: any[] = [];
    function walk(tree: any) {
      if (!tree) return;
      if (Array.isArray(tree)) { tree.forEach(walk); }
      else { if (tree.id) flat.push(tree); if (tree.children) tree.children.forEach(walk); }
    }
    walk(r);
    nodes.value = flat;
  } catch (_) { ElMessage.error("加载节点失败"); }
}

async function loadParams() {
  if (!selectedNode.value) return;
  loading.value = true;
  try { params.value = await api.get("/process_nodes/" + selectedNode.value + "/params"); }
  catch (_) { ElMessage.error("加载参数失败"); }
  finally { loading.value = false; }
  renderTrends();
}

function openAdd() {
  dlg.form = { current_amp: null, voltage_v: null, speed_mm_min: null, temperature_c: null, pressure_mpa: null, feed_rate: null, notes: "" };
  dlg.visible = true;
}

async function saveParam() {
  dlg.saving = true;
  try {
    await api.post("/process_nodes/" + selectedNode.value + "/params", dlg.form);
    ElMessage.success("参数已记录");
    dlg.visible = false;
    loadParams();
  } catch (_e) { ElMessage.error("记录失败"); }
  finally { dlg.saving = false; }
}

async function runSpc() {
  spcLoading.value = true;
  try {
    spcResult.value = await api.get("/spc/analyze", { params: { process_node_id: selectedNode.value, param: spcParam.value } });
  } catch (_e) { ElMessage.error("SPC 分析失败"); }
  finally { spcLoading.value = false; }
}

onMounted(loadInstances);
</script>

<style scoped>
.page{padding:16px 24px}
.page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px}
.page-title{font-size:20px;font-weight:600}
</style>
