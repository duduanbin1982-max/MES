import { reactive, ref, onMounted, watch } from 'vue'
import { formatJsonForInput, parseJsonInput } from '../domain/jsonField'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

export function useUserManagementPage() {

  const route = useRoute()
  const router = useRouter()
  const tabNames = new Set(['users', 'groups', 'matrix'])
  const routeTab = () => {
    const value = String(route.query.tab || '')
    return tabNames.has(value) ? value : 'users'
  }
  const tab = ref(routeTab())
  watch(tab, (value) => {
    if (route.query.tab !== value) router.replace({ query: { ...route.query, tab: value } })
  })
  watch(() => route.query.tab, () => {
    const next = routeTab()
    if (next !== tab.value) tab.value = next
  })
  const users = ref<any[]>([])
  const roles = ref<any[]>([])
  const roleGroups = ref<any[]>([])
  const permissionCatalog = ref<any[]>([])
  const loading = ref(false)

  const dlg = reactive<any>({ visible: false, isEdit: false, saving: false, form: {} })
  const groupDlg = reactive<any>({ visible: false, isEdit: false, saving: false, form: {} })
  const roleDlg = reactive<any>({ visible: false, isEdit: false, saving: false, form: {} })
  const permDlg = reactive<any>({ visible: false, saving: false, role: null, superAdmin: false })
  const permMap = reactive<Record<string, boolean>>({})

  // P1-1：数据范围（5+1 种），与后端 app/dataScope.js 的 SCOPES 对齐
  const dataScopeOptions = [
    { value: 'all', label: '全部数据' },
    { value: 'instance', label: '按装备/项目' },
    { value: 'workshop', label: '按车间' },
    { value: 'workstation', label: '按工位' },
    { value: 'warehouse', label: '按仓库' },
    { value: 'self', label: '仅本人相关' },
  ]
  const dataScopeLabel = (value: string) => (dataScopeOptions.find(o => o.value === value)?.label) || '-'
  const scopeNeedsConfig = (scope: string) => scope === 'instance' || scope === 'workshop' || scope === 'workstation' || scope === 'warehouse'
  const myScope = ref<any>(null)
  const loadMyScope = async () => {
    try { myScope.value = await Api.get('/me/scope') } catch (_) { myScope.value = null }
  }
  // 统一用 domain/jsonField（有单测），避免"对象 v-model 到输入框显示 [object Object]"
  const parseJsonField = (text: unknown, label = '配置') => parseJsonInput(text, label)
  const previewPerms = (perms: string[] = []) => perms.includes('*') ? ['*'] : perms.slice(0, 8)

  const loadUsers = async () => {
    loading.value = true
    try { const r = await Api.get('/users'); users.value = r.items || [] }
    catch (_) { users.value = []; ElMessage.error('加载用户失败') }
    finally { loading.value = false }
  }

  const loadRoles = async () => {
    try {
      const r = await Api.get('/roles')
      const list = Array.isArray(r) ? r : (r.items || [])
      roles.value = list.map((role: any) => ({
        ...role,
        code: role.code || role.role_code,
        name: role.name || role.role_name,
      }))
    }
    catch (_) { roles.value = []; ElMessage.error('加载角色失败') }
  }

  const loadRoleGroups = async () => {
    try { const r = await Api.get('/role-groups'); roleGroups.value = r.items || [] }
    catch (_) { roleGroups.value = []; ElMessage.error('加载角色组失败') }
  }

  const loadPermissionCatalog = async () => {
    try { const r = await Api.get('/permissions/catalog'); permissionCatalog.value = r.items || [] }
    catch (_) { permissionCatalog.value = []; ElMessage.error('加载权限目录失败') }
  }

  const openCreate = () => {
    dlg.isEdit = false
    dlg.form = { username: '', password: '', full_name: '', role_code: '', role_group_id: null, phone: '', is_active: true }
    dlg.visible = true
  }

  const editUser = (row: any) => {
    dlg.isEdit = true
    dlg.form = {
      ...row,
      password: '',
      // P1-1：用户级数据范围覆盖（空 = 继承角色组）
      data_scope: row.data_scope_override || '',
      data_scope_config: formatJsonForInput(row.data_scope_config_override),
    }
    dlg.visible = true
  }

  const applyGroupDefault = (groupId: number) => {
    const group = roleGroups.value.find(g => g.id === groupId)
    if (group?.default_role_code && !dlg.isEdit) dlg.form.role_code = group.default_role_code
  }

  const saveUser = async () => {
    dlg.saving = true
    try {
      // P1-1：把范围配置字符串解析成对象（后端会 JSON.stringify 入库）
      const payload: any = { ...dlg.form }
      payload.data_scope = dlg.form.data_scope || null
      payload.data_scope_config = parseJsonField(dlg.form.data_scope_config, '数据范围配置') ?? null
      if (dlg.isEdit) {
        await Api.patch('/users/' + dlg.form.id, payload)
        ElMessage.success('用户已更新')
      } else {
        await Api.post('/users', payload)
        ElMessage.success('用户已创建')
      }
      dlg.visible = false
      loadUsers()
    } catch (e: any) { ElMessage.error(e?.response?.data?.message || e?.message || '操作失败') }
    finally { dlg.saving = false }
  }

  const delUser = async (row: any) => {
    try {
      await ElMessageBox.confirm('确定删除用户 ' + row.username + ' 吗?', '确认', { type: 'warning' })
      await Api.del('/users/' + row.id)
      ElMessage.success('已删除')
      loadUsers()
    } catch (e: any) {
      if (e !== 'cancel' && e !== 'close') ElMessage.error('操作失败')
    }
  }


  let suggestTimer: ReturnType<typeof setTimeout> | null = null
  const onRoleNameInput = () => {
    if (roleDlg.isEdit || !roleDlg.form.role_name) return
    if (suggestTimer) clearTimeout(suggestTimer)
    suggestTimer = setTimeout(async () => {
      try {
        const res = await Api.get("/roles/suggest-code", { params: { name: roleDlg.form.role_name } })
        if (res.code && !roleDlg.form.role_code) roleDlg.form.role_code = res.code
      } catch (_) { /* ignore */ }
    }, 400)
  }

  const onGroupNameInput = () => {
    if (groupDlg.isEdit || !groupDlg.form.group_name) return
    if (suggestTimer) clearTimeout(suggestTimer)
    suggestTimer = setTimeout(async () => {
      try {
        const res = await Api.get("/role-groups/suggest-code", { params: { name: groupDlg.form.group_name } })
        if (res.code && !groupDlg.form.group_code) groupDlg.form.group_code = res.code
      } catch (_) { /* ignore */ }
    }, 400)
  }

  const openGroupDialog = (row?: any) => {
    groupDlg.isEdit = !!row
    groupDlg.form = row ? {
      ...row,
      group_code: row.group_code,
      scope_config: formatJsonForInput(row.scope_config),
    } : {
      group_code: '', group_name: '', default_role_code: '', data_scope: 'all',
      scope_config: '', default_home: '', description: '', is_active: true,
    }
    groupDlg.visible = true
  }

  const saveGroup = async () => {
    groupDlg.saving = true
    try {
      // P1-1：角色组的 scope_config（按装备/车间/工位/仓库筛选范围）
      const payload: any = { ...groupDlg.form }
      payload.scope_config = parseJsonField(groupDlg.form.scope_config, '范围配置') ?? {}
      if (groupDlg.isEdit) await Api.patch('/role-groups/' + groupDlg.form.id, payload)
      else await Api.post('/role-groups', payload)
      ElMessage.success('角色组已保存')
      groupDlg.visible = false
      await loadRoleGroups()
    } catch (e: any) { ElMessage.error(e?.response?.data?.message || e?.message || '保存失败') }
    finally { groupDlg.saving = false }
  }

  const openRoleDialog = (row?: any) => {
    roleDlg.isEdit = !!row
    roleDlg.form = row ? {
      role_code: row.code,
      role_name: row.name,
      description: row.description || '',
    } : {
      role_code: '',
      role_name: '',
      copy_from: '',
      description: '',
    }
    roleDlg.visible = true
  }

  const copyRole = (row: any) => {
    roleDlg.isEdit = false
    roleDlg.form = {
      role_code: '',
      role_name: row.name ? row.name + '副本' : '',
      copy_from: row.code,
      description: row.description || '',
    }
    roleDlg.visible = true
  }

  const saveRole = async () => {
    roleDlg.saving = true
    try {
      if (roleDlg.isEdit) {
        await Api.patch('/roles/' + roleDlg.form.role_code, {
          role_name: roleDlg.form.role_name,
          description: roleDlg.form.description,
        })
        ElMessage.success('角色已更新')
      } else {
        await Api.post('/roles', {
          role_code: roleDlg.form.role_code,
          role_name: roleDlg.form.role_name,
          copy_from: roleDlg.form.copy_from || undefined,
          description: roleDlg.form.description,
        })
        ElMessage.success('角色已创建，可继续编辑权限矩阵')
      }
      roleDlg.visible = false
      await Promise.all([loadRoles(), loadRoleGroups(), loadUsers()])
    } catch (e: any) { ElMessage.error(e?.response?.data?.message || e?.message || '保存失败') }
    finally { roleDlg.saving = false }
  }

  const deleteRole = async (row: any) => {
    try {
      await ElMessageBox.confirm('确定删除角色 ' + row.code + ' 吗？已被用户或角色组使用的角色不能删除。', '确认删除', { type: 'warning' })
      await Api.del('/roles/' + row.code)
      ElMessage.success('角色已删除')
      await Promise.all([loadRoles(), loadRoleGroups(), loadUsers()])
    } catch (e: any) {
      if (e !== 'cancel' && e !== 'close') ElMessage.error(e?.response?.data?.message || e?.message || '删除失败')
    }
  }

  const editPerms = (row: any) => {
    permDlg.role = row
    permDlg.superAdmin = (row.permissions || []).includes('*')
    Object.keys(permMap).forEach(k => delete permMap[k])
    for (const group of permissionCatalog.value) {
      for (const permission of group.permissions) permMap[permission.code] = (row.permissions || []).includes(permission.code)
    }
    permDlg.visible = true
  }

  const toggleSuperAdmin = () => {
    permMap['*'] = permDlg.superAdmin
  }

  const savePerms = async () => {
    permDlg.saving = true
    try {
      const permissions = permDlg.superAdmin ? ['*'] : Object.entries(permMap).filter(([code, checked]) => checked && code !== '*').map(([code]) => code)
      await Api.put('/roles/' + permDlg.role.code + '/permissions', { permissions })
      ElMessage.success('权限矩阵已更新，用户重新登录后生效')
      permDlg.visible = false
      await loadRoles()
    } catch (e: any) { ElMessage.error(e?.response?.data?.message || e?.message || '保存失败') }
    finally { permDlg.saving = false }
  }

  onMounted(async () => {
    loadMyScope()
    await Promise.all([loadRoles(), loadRoleGroups(), loadPermissionCatalog()])
    await loadUsers()
  })

  return {
    route,
    router,
    tabNames,
    routeTab,
    tab,
    users,
    roles,
    roleGroups,
    permissionCatalog,
    loading,
    dlg,
    groupDlg,
    roleDlg,
    permDlg,
    permMap,
    dataScopeLabel,
    dataScopeOptions,
    scopeNeedsConfig,
    myScope,
    loadMyScope,
    previewPerms,
    loadUsers,
    loadRoles,
    loadRoleGroups,
    loadPermissionCatalog,
    openCreate,
    editUser,
    applyGroupDefault,
    saveUser,
    delUser,
    onRoleNameInput,
    onGroupNameInput,
    openGroupDialog,
    saveGroup,
    openRoleDialog,
    copyRole,
    saveRole,
    deleteRole,
    editPerms,
    toggleSuperAdmin,
    savePerms,
  }
}
