import { useRoute } from 'vue-router'
import { useProcessTree } from './useProcessTree.js'
import { createProcessTreePageState } from './processTreePage/state.js'
import { useProcessTreePageCommands } from './processTreePage/commands.js'
import { useProcessTreePageData } from './processTreePage/data.js'
import { useProcessTreePageNavigation } from './processTreePage/navigation.js'

export function useProcessTreePage() {
  const route = useRoute()
  const state = createProcessTreePageState()
  const processTree = useProcessTree(state.selectedInstance)
  const data = useProcessTreePageData({ route, state, load: processTree.load })
  const navigation = useProcessTreePageNavigation(state)
  const commands = useProcessTreePageCommands({
    state,
    reloadAll: data.reloadAll,
  })

  return {
    allExpanded: state.allExpanded,
    assignForm: state.assignForm,
    autoBindRoutes: commands.autoBindRoutes,
    autoBinding: state.autoBinding,
    componentRouteSummary: state.componentRouteSummary,
    cpm: processTree.cpm,
    criticalSet: processTree.criticalSet,
    currentUserId: state.currentUserId,
    depForm: state.depForm,
    editForm: state.editForm,
    filteredComponentRoutes: state.filteredComponentRoutes,
    filters: state.filters,
    flat: processTree.flat,
    focusComponentRoute: navigation.focusComponentRoute,
    focusProcessNode: navigation.focusProcessNode,
    generateMissingRoutes: commands.generateMissingRoutes,
    hasRouteGaps: state.hasRouteGaps,
    hoursForm: state.hoursForm,
    hoursSaving: state.hoursSaving,
    instances: state.instances,
    loadComponentRoutes: data.loadComponentRoutes,
    loading: processTree.loading,
    onAddRoot: commands.onAddRoot,
    onCmd: commands.onCmd,
    onComplete: commands.onComplete,
    onMindmapNavigate: navigation.onMindmapNavigate,
    onNodeDropped: commands.onNodeDropped,
    onStart: commands.onStart,
    operationTemplates: state.operationTemplates,
    progress: processTree.progress,
    regenerate: commands.regenerate,
    regenerating: state.regenerating,
    reloadAll: data.reloadAll,
    routeCompletenessPct: state.routeCompletenessPct,
    routeFixing: state.routeFixing,
    routeGapFilter: state.routeGapFilter,
    saveAssign: commands.saveAssign,
    saveDep: commands.saveDep,
    saveHours: commands.saveHours,
    saveNode: commands.saveNode,
    saving: state.saving,
    scrollToCard: navigation.scrollToCard,
    selectedInstance: state.selectedInstance,
    selectedInstanceMeta: state.selectedInstanceMeta,
    showAssign: state.showAssign,
    showDep: state.showDep,
    showEdit: state.showEdit,
    showHours: state.showHours,
    subsystems: state.subsystems,
    subsystemsList: state.subsystemsList,
    toggleExpandAll: navigation.toggleExpandAll,
    tree: processTree.tree,
    uncategorized: state.uncategorized,
    users: state.users,
    workstations: state.workstations,
  }
}
