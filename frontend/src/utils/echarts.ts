// frontend/src/utils/echarts.ts
// 2026-11-07 UI/UX 后续项：ECharts 按图表类型模块化引入（替代 import * as echarts from 'echarts'）
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart, TreeChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  TreeChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  MarkLineComponent,
  GraphicComponent,
  CanvasRenderer,
])

export { echarts }
export default echarts
