<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div class="page-title"><el-icon><Setting /></el-icon> 工艺参数监控 (MESA #8)</div>
      <div>
        <el-select v-model="selectedInstance" placeholder="选择装备实例" style="width: 240px; margin-right: 8px" @change="loadNodes">
          <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
        </el-select>
        <el-select v-model="selectedNode" placeholder="选择工艺节点" filterable style="width: 280px; margin-right: 8px" @change="loadParams">
          <el-option v-for="n in nodes" :key="n.id" :label="`#${n.id} ${n.name || n.operation_name || ''} (${n.node_type || n.operation_type || '工序'})`" :value="n.id" />
        </el-select>
        <el-button type="primary" @click="loadParams" :loading="loading">查询</el-button>
        <el-button @click="openSpecs" :disabled="!selectedNode">规格设置</el-button>
        <el-button @click="openAdd" :disabled="!selectedNode">+ 记录参数</el-button>
      </div>
    </PageToolbar>

    <div v-if="!selectedNode" style="text-align: center; padding: 40px">
      <PageState state="empty" compact :show-action="false" description="选择装备实例和工艺节点查看参数" />
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
          <template #default="{row}"><span :class="{ 'out-of-spec': isOut('current_amp', row.current_amp) }">{{ row.current_amp != null ? row.current_amp : '-' }}</span></template>
        </el-table-column>
        <el-table-column label="电压(V)" width="90" align="right">
          <template #default="{row}"><span :class="{ 'out-of-spec': isOut('voltage_v', row.voltage_v) }">{{ row.voltage_v != null ? row.voltage_v : '-' }}</span></template>
        </el-table-column>
        <el-table-column label="速度(mm/min)" width="110" align="right">
          <template #default="{row}"><span :class="{ 'out-of-spec': isOut('speed_mm_min', row.speed_mm_min) }">{{ row.speed_mm_min != null ? row.speed_mm_min : '-' }}</span></template>
        </el-table-column>
        <el-table-column label="温度(°C)" width="100" align="right">
          <template #default="{row}">
            <span :class="{ 'out-of-spec': isOut('temperature_c', row.temperature_c) }">{{ row.temperature_c != null ? row.temperature_c : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="压力(MPa)" width="100" align="right">
          <template #default="{row}"><span :class="{ 'out-of-spec': isOut('pressure_mpa', row.pressure_mpa) }">{{ row.pressure_mpa != null ? row.pressure_mpa : '-' }}</span></template>
        </el-table-column>
        <el-table-column label="进给率" width="90" align="right">
          <template #default="{row}"><span :class="{ 'out-of-spec': isOut('feed_rate', row.feed_rate) }">{{ row.feed_rate != null ? row.feed_rate : '-' }}</span></template>
        </el-table-column>
        <el-table-column label="判定" width="120">
          <template #default="{row}">
            <el-tag v-if="rowStatus(row).length" size="small" type="danger">{{ rowStatus(row).join('、') }}</el-tag>
            <el-tag v-else size="small" type="success">OK</el-tag>
          </template>
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

    <el-dialog v-model="specDlg.visible" title="工艺参数规格（LSL / USL）" width="820px">
      <el-alert type="info" :closable="false" show-icon title="规格用于 SPC 控制图、过程能力 Cpk/Ppk 和参数偏差判定；LSL/USL 必填，target 可选。" style="margin-bottom:10px" />
      <el-form label-width="120px">
        <el-row :gutter="10" v-for="p in trendParams" :key="p.key">
          <el-col :span="7"><el-form-item :label="p.label"><span /></el-form-item></el-col>
          <el-col :span="17">
            <el-row :gutter="6">
              <el-col :span="6"><el-form-item label="LSL"><el-input-number v-model="specDlg.form[p.key].lsl" :controls="false" style="width:100%" /></el-form-item></el-col>
              <el-col :span="6"><el-form-item label="USL"><el-input-number v-model="specDlg.form[p.key].usl" :controls="false" style="width:100%" /></el-form-item></el-col>
              <el-col :span="6"><el-form-item label="目标"><el-input-number v-model="specDlg.form[p.key].target" :controls="false" style="width:100%" /></el-form-item></el-col>
              <el-col :span="6"><el-form-item label="单位"><el-input v-model="specDlg.form[p.key].unit" style="width:100%" /></el-form-item></el-col>
            </el-row>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="specDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="specDlg.saving" @click="saveSpecs">保存规格</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from "vue";
import api from "../api";
import { ElMessage } from "element-plus";
import { echarts } from '../utils/echarts';

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
const specs = ref<Record<string, any>>({});
const specDlg = reactive<any>({ visible: false, saving: false, form: {} });

const chartRefs: Record<string, any> = {};
const chartInstances: Record<string, any> = {};

const trendParams: Array<{ key: string; label: string; alerts?: number }> = [
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
            data: (() => {
              const spec = specFor(p.key);
              const marks: any[] = [{ type: "average", name: "均值", lineStyle: { color: "var(--el-color-success)", type: "dashed" } }];
              if (spec?.lsl != null) marks.push({ yAxis: spec.lsl, name: "LSL", lineStyle: { color: "var(--el-color-danger)", type: "dashed" } });
              if (spec?.usl != null) marks.push({ yAxis: spec.usl, name: "USL", lineStyle: { color: "var(--el-color-danger)", type: "dashed" } });
              return marks;
            })(),
          },
        }],
      });
    } catch (error) {
      /* 2026-10-17: 移除前端调试日志（前端统一用 ElMessage 提示） */
    }
  }
}

async function loadInstances() {
  try { const r = await api.get("/equipment_instances"); instances.value = r.items || r || []; }
  catch (_) { ElMessage.error("加载实例失败"); }
}

async function loadNodes() {
  selectedNode.value = null;
  params.value = [];
  specs.value = {};
  spcResult.value = null;
  if (!selectedInstance.value) return;
  try {
    const r = await api.get("/equipment_instances/" + selectedInstance.value + "/process_tree");
    if (Array.isArray(r?.flat)) {
      nodes.value = r.flat;
      return;
    }
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
  spcResult.value = null;
  try {
    const [paramData, specData] = await Promise.all([
      api.get("/process_nodes/" + selectedNode.value + "/params"),
      api.get("/process_nodes/" + selectedNode.value + "/params/specs"),
    ]);
    params.value = paramData || [];
    specs.value = specData?.specs || {};
  } catch (_) { ElMessage.error("加载参数失败"); }
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

function specFor(key: string) {
  return specs.value?.[key] || null;
}

function isOut(key: string, value: any) {
  if (value === null || value === undefined) return false;
  const spec = specFor(key);
  if (!spec || spec.lsl == null || spec.usl == null) return false;
  return Number(value) < Number(spec.lsl) || Number(value) > Number(spec.usl);
}

function rowStatus(row: any) {
  return trendParams.filter((p) => isOut(p.key, row[p.key])).map((p) => p.label.replace(/\s*\(.*$/, ""));
}

function openSpecs() {
  const form: any = {};
  for (const p of trendParams) {
    const current = specFor(p.key) || {};
    form[p.key] = { lsl: current.lsl ?? null, usl: current.usl ?? null, target: current.target ?? null, unit: current.unit || "" };
  }
  specDlg.form = form;
  specDlg.visible = true;
}

async function saveSpecs() {
  const payload: any = {};
  for (const p of trendParams) {
    const item = specDlg.form[p.key] || {};
    if (item.lsl === null || item.lsl === undefined || item.usl === null || item.usl === undefined) continue;
    if (Number(item.lsl) > Number(item.usl)) return ElMessage.warning(`${p.label} 的 LSL 不能大于 USL`);
    payload[p.key] = { lsl: Number(item.lsl), usl: Number(item.usl) };
    if (item.target !== null && item.target !== undefined && item.target !== "") payload[p.key].target = Number(item.target);
    if (item.unit) payload[p.key].unit = String(item.unit).trim();
  }
  if (!Object.keys(payload).length) return ElMessage.warning("至少填写一个参数的 LSL/USL");
  specDlg.saving = true;
  try {
    await api.put(`/process_nodes/${selectedNode.value}/params/specs`, { specs: payload });
    ElMessage.success("规格已保存");
    specDlg.visible = false;
    await loadParams();
  } catch (error: any) {
    ElMessage.error("保存规格失败：" + (error?.response?.data?.message || error.message));
  } finally {
    specDlg.saving = false;
  }
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
.out-of-spec{color:var(--el-color-danger);font-weight:700}
</style>
