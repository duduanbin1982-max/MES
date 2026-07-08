import { ref } from 'vue'
import Api from '../../api'

export function useQualityDashboard() {
  const dash = ref<any>({ pass_rate_30d: 0, ncr_open: 0, ncr_resolved_30d: 0, capa_open: 0, capa_overdue: 0, defect_top5: [] })
  const spcDash = ref<any>({ monitored_nodes_24h: 0, unacknowledged: 0, recent_alerts: [] })

  const loadDashboard = async () => {
    try { dash.value = await Api.get('/qc/dashboard') } catch { dash.value.defect_top5 = [] }
    try { spcDash.value = await Api.get('/spc/dashboard') } catch { spcDash.value.recent_alerts = [] }
  }

  return { dash, spcDash, loadDashboard }
}
