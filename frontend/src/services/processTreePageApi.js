import { Api } from '../api'

const authToken = () => localStorage.getItem('tbm_access_token') || localStorage.getItem('tbm_token') || ''
const authHeader = () => {
  const token = authToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const jsonHeaders = () => ({ 'Content-Type': 'application/json', ...authHeader() })

const readJson = async (response) => {
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return response.json()
}

export const processTreePageApi = {
  async loadComponentRoutes(instanceId) {
    const data = await fetch('/api/process-route/instances/' + instanceId + '/components', { headers: authHeader() }).then(readJson)
    return {
      components: data.components || [],
      summary: data.summary || {},
    }
  },

  async loadSubsystems(instanceId) {
    const data = await fetch('/api/equipment_instances/' + instanceId + '/subsystems', { headers: authHeader() }).then(readJson)
    return {
      subsystems: data.subsystems || [],
      uncategorized: data.uncategorized || [],
    }
  },

  async loadOperationTemplates() {
    const response = await Api.get('/process-master/operations')
    return response.items || []
  },

  async loadSubsystemsList() {
    const response = await fetch('/api/equipment_subsystems', { headers: authHeader() })
    if (!response.ok) return []
    const data = await response.json()
    return (data.rows || data || []).map((subsystem) => ({
      id: subsystem.id,
      code: subsystem.code,
      name_zh: subsystem.name_zh,
      name_en: subsystem.name_en,
      sequence: subsystem.sequence,
    }))
  },

  async generateMissingRoutes(instanceId) {
    const data = await fetch('/api/process-route/instances/' + instanceId + '/generate-missing', {
      method: 'POST',
      headers: authHeader(),
    }).then(readJson)
    return data.created || 0
  },

  async autoBindRoutes(instanceId) {
    const data = await fetch('/api/process-route/instances/' + instanceId + '/auto-bind', {
      method: 'POST',
      headers: authHeader(),
    }).then(readJson)
    return data.changed || 0
  },

  async regenerate(instanceId) {
    await fetch('/api/equipment_instances/' + instanceId + '/process_tree/generate', {
      method: 'POST',
      headers: authHeader(),
    }).then(readJson)
  },

  async executeNode(nodeId, body) {
    const response = await fetch('/api/process_nodes/' + nodeId + '/execute', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error('HTTP ' + response.status)
  },

  async deleteNode(nodeId) {
    const response = await fetch('/api/process_nodes/' + nodeId, {
      method: 'DELETE',
      headers: authHeader(),
    })
    if (!response.ok) throw new Error('HTTP ' + response.status)
  },

  async saveNode(formData) {
    if (formData.id) {
      const putBody = { ...formData }
      delete putBody.subsystem_id
      await fetch('/api/process_nodes/' + formData.id, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify(putBody),
      }).then(readJson)

      await fetch('/api/process_nodes/' + formData.id + '/subsystem', {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ subsystem_id: formData.subsystem_id ?? null }),
      }).then(readJson)
      return
    }

    await fetch('/api/process_nodes', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(formData),
    }).then(readJson)
  },

  async assignNode(assignForm) {
    const response = await fetch('/api/process_nodes/' + assignForm.id + '/assign', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify(assignForm),
    })
    if (!response.ok) throw new Error('HTTP ' + response.status)
  },

  async saveDependency(instanceId, depForm) {
    const response = await fetch('/api/process_dependencies', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        equipment_instance_id: instanceId,
        predecessor_id: depForm.predecessor_id,
        successor_id: depForm.successor_id,
        dep_type: depForm.dep_type,
      }),
    })
    if (!response.ok) throw new Error('HTTP ' + response.status)
  },

  async saveHours(hoursForm) {
    const response = await fetch('/api/process/nodes/' + hoursForm.id + '/hours', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        work_type: hoursForm.work_type,
        standard_hours: hoursForm.standard_hours,
        worker_count: hoursForm.worker_count,
        description: hoursForm.description,
      }),
    })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    await response.json().catch(() => null)
  },

  async moveNodeSubsystem(nodeId, subsystemId) {
    const response = await fetch('/api/process_nodes/' + nodeId + '/subsystem', {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ subsystem_id: subsystemId }),
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error('HTTP ' + response.status + (errorText ? ' — ' + errorText : ''))
    }
  },
}
