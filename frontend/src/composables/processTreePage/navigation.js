import { ElMessage } from 'element-plus'

export function useProcessTreePageNavigation(state) {
  const toggleExpandAll = () => {
    state.allExpanded.value = !state.allExpanded.value
  }

  const flashElement = (element, className = 'focus-flash') => {
    if (!element) return false
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element.classList.add(className)
    window.setTimeout(() => element.classList.remove(className), 1600)
    return true
  }

  const scrollToCard = (subsystemId) => {
    const key = subsystemId == null ? 'uncategorized' : String(subsystemId)
    const element = document.querySelector(`.subsystem-card[data-subsystem-id="${key}"]`)
    if (!flashElement(element)) ElMessage.info('没有找到对应子系统卡片')
  }

  const focusProcessNode = (nodeId) => {
    const element = document.querySelector(`.node-row[data-node-id="${nodeId}"]`)
    if (!flashElement(element, 'node-flash')) ElMessage.info('该工序节点当前不在可见筛选结果中')
  }

  const focusComponentRoute = (row) => {
    const firstOperation = row.operations?.[0]
    if (!firstOperation) {
      ElMessage.info('该部件尚未生成工序，可点击“生成缺失工序”')
      return
    }
    focusProcessNode(firstOperation.id)
  }

  const onMindmapNavigate = (navigation) => {
    console.log('[mindmap navigate]', navigation)
  }

  return { focusComponentRoute, focusProcessNode, onMindmapNavigate, scrollToCard, toggleExpandAll }
}
