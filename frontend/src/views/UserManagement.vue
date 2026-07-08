<template>
  <div class="page">
    <div class="page-header">
      <div>
        <div class="page-title">👥 用户与权限管理</div>
        <div class="sub">用户 → 角色组/部门 → 角色 → 权限矩阵；角色组负责批量归属和默认首页，角色负责具体权限。</div>
      </div>
      <el-button type="primary" @click="openCreate">+ 新建用户</el-button>
    </div>

    <el-tabs v-model="tab">
      <el-tab-pane label="用户列表" name="users">
        <el-card>
          <el-table :data="users" stripe v-loading="loading" size="small">
            <el-table-column prop="id" label="ID" width="60" />
            <el-table-column prop="username" label="用户名" width="120" />
            <el-table-column prop="full_name" label="姓名" width="120" />
            <el-table-column prop="group_name" label="角色组/部门" width="130">
              <template #default="{ row }"><el-tag v-if="row.group_name" size="small">{{ row.group_name }}</el-tag><span v-else>-</span></template>
            </el-table-column>
            <el-table-column prop="role_name" label="角色" width="120" />
            <el-table-column prop="role_code" label="角色编码" width="110" />
            <el-table-column prop="data_scope" label="数据范围" width="110">
              <template #default="{ row }">{{ dataScopeLabel(row.data_scope) }}</template>
            </el-table-column>
            <el-table-column prop="default_home" label="默认首页" min-width="150" show-overflow-tooltip />
            <el-table-column prop="phone" label="手机" width="130" />
            <el-table-column label="状态" width="80" align="center">
              <template #default="{ row }">
                <el-tag :type="row.is_active ? 'success' : 'danger'" size="small">{{ row.is_active ? '启用' : '禁用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="last_login" label="最后登录" width="160" />
            <el-table-column label="操作" width="160" align="center" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="editUser(row)">编辑</el-button>
                <el-button size="small" type="danger" @click="delUser(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="角色组" name="groups">
        <el-card>
          <template #header>
            <div class="card-head">
              <span>🏷️ 角色组/部门</span>
              <el-button type="primary" size="small" @click="openGroupDialog()">+ 新建角色组</el-button>
            </div>
          </template>
          <el-table :data="roleGroups" stripe size="small">
            <el-table-column prop="group_code" label="编码" width="120" />
            <el-table-column prop="group_name" label="名称" width="130" />
            <el-table-column prop="default_role_name" label="默认角色" width="120" />
            <el-table-column label="数据范围" width="120"><template #default="{ row }">{{ dataScopeLabel(row.data_scope) }}</template></el-table-column>
            <el-table-column prop="default_home" label="默认首页" width="180" />
            <el-table-column prop="user_count" label="用户数" width="80" />
            <el-table-column prop="description" label="说明" min-width="220" />
            <el-table-column label="状态" width="80"><template #default="{ row }"><el-tag :type="row.is_active ? 'success' : 'info'" size="small">{{ row.is_active ? '启用' : '停用' }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button size="small" @click="openGroupDialog(row)">编辑</el-button></template></el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="权限矩阵" name="matrix">
        <el-card style="margin-bottom: 16px">
          <template #header>
            <div class="card-head">
              <span>🔑 角色管理 / 权限矩阵</span>
              <el-button type="primary" size="small" @click="openRoleDialog()">+ 新建角色</el-button>
            </div>
          </template>
          <el-table :data="roles" stripe size="small">
            <el-table-column prop="code" label="角色编码" width="130" />
            <el-table-column prop="name" label="角色名" width="130" />
            <el-table-column label="类型" width="100" align="center">
              <template #default="{ row }">
                <el-tag :type="row.is_builtin ? 'info' : 'success'" size="small">{{ row.is_builtin ? '系统内置' : '自定义' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="user_count" label="用户数" width="80" align="center" />
            <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip />
            <el-table-column label="权限数" width="90"><template #default="{ row }">{{ row.permissions?.includes('*') ? '全部' : row.permissions?.length || 0 }}</template></el-table-column>
            <el-table-column label="关键权限" min-width="260">
              <template #default="{ row }">
                <el-tag v-for="p in previewPerms(row.permissions)" :key="p" size="small" style="margin: 2px">{{ p }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="260" align="center" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="openRoleDialog(row)">编辑</el-button>
                <el-button size="small" @click="copyRole(row)">复制</el-button>
                <el-button size="small" type="primary" plain @click="editPerms(row)">矩阵</el-button>
                <el-button size="small" type="danger" :disabled="row.code === 'admin' || Number(row.user_count || 0) > 0" @click="deleteRole(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card>
          <template #header><span>📚 权限目录</span></template>
          <el-table :data="permissionCatalog" size="small" stripe>
            <el-table-column prop="label" label="模块" width="140" />
            <el-table-column label="权限码">
              <template #default="{ row }">
                <el-tag v-for="p in row.permissions" :key="p.code" size="small" style="margin: 3px">
                  {{ p.code }} - {{ p.description }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="dlg.visible" :title="dlg.isEdit ? '编辑用户' : '新建用户'" width="520px">
      <el-form :model="dlg.form" label-width="100px">
        <el-form-item label="用户名" required><el-input v-model="dlg.form.username" :disabled="dlg.isEdit" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="dlg.form.password" type="password" :placeholder="dlg.isEdit ? '留空不修改' : '必填'" /></el-form-item>
        <el-form-item label="姓名" required><el-input v-model="dlg.form.full_name" /></el-form-item>
        <el-form-item label="角色组">
          <el-select v-model="dlg.form.role_group_id" clearable style="width: 100%" @change="applyGroupDefault">
            <el-option v-for="g in roleGroups" :key="g.id" :label="g.group_name + ' / ' + g.group_code" :value="g.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色" required>
          <el-select v-model="dlg.form.role_code" style="width: 100%">
            <el-option v-for="r in roles" :key="r.code" :label="r.code + ' - ' + r.name" :value="r.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="手机"><el-input v-model="dlg.form.phone" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="dlg.form.is_active" active-text="启用" inactive-text="禁用" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" @click="saveUser" :loading="dlg.saving">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="groupDlg.visible" :title="groupDlg.isEdit ? '编辑角色组' : '新建角色组'" width="560px">
      <el-form :model="groupDlg.form" label-width="100px">
        <el-form-item label="组编码" required><el-input v-model="groupDlg.form.group_code" :disabled="groupDlg.isEdit" placeholder="production / warehouse" /></el-form-item>
        <el-form-item label="组名称" required><el-input v-model="groupDlg.form.group_name" placeholder="生产部 / 仓储部" /></el-form-item>
        <el-form-item label="默认角色">
          <el-select v-model="groupDlg.form.default_role_code" clearable style="width: 100%">
            <el-option v-for="r in roles" :key="r.code" :label="r.code + ' - ' + r.name" :value="r.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="数据范围">
          <el-select v-model="groupDlg.form.data_scope" style="width: 100%">
            <el-option label="全部数据" value="all" />
            <el-option label="按车间" value="workshop" />
            <el-option label="按仓库" value="warehouse" />
            <el-option label="按装备/项目" value="instance" />
            <el-option label="仅本人相关" value="self" />
          </el-select>
        </el-form-item>
        <el-form-item label="默认首页"><el-input v-model="groupDlg.form.default_home" placeholder="/delivery 或 /shopfloor?tab=pick" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="groupDlg.form.description" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="groupDlg.form.is_active" active-text="启用" inactive-text="停用" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="groupDlg.visible = false">取消</el-button>
        <el-button type="primary" @click="saveGroup" :loading="groupDlg.saving">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="roleDlg.visible" :title="roleDlg.isEdit ? '编辑角色' : '新建角色'" width="560px">
      <el-form :model="roleDlg.form" label-width="100px">
        <el-form-item label="角色编码" required>
          <el-input v-model="roleDlg.form.role_code" :disabled="roleDlg.isEdit" placeholder="如 planner / warehouse_lead" />
        </el-form-item>
        <el-form-item label="角色名称" required><el-input v-model="roleDlg.form.role_name" placeholder="如 计划员 / 仓库主管" /></el-form-item>
        <el-form-item v-if="!roleDlg.isEdit" label="复制权限">
          <el-select v-model="roleDlg.form.copy_from" clearable placeholder="可选择一个已有角色作为模板" style="width: 100%">
            <el-option v-for="r in roles" :key="r.code" :label="r.code + ' - ' + r.name" :value="r.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="说明"><el-input v-model="roleDlg.form.description" type="textarea" :rows="3" maxlength="200" show-word-limit /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDlg.visible = false">取消</el-button>
        <el-button type="primary" @click="saveRole" :loading="roleDlg.saving">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="permDlg.visible" title="权限矩阵编辑" width="900px">
      <div v-if="permDlg.role" style="margin-bottom: 12px">
        <strong>{{ permDlg.role.code }} - {{ permDlg.role.name }}</strong>
        <el-checkbox v-model="permDlg.superAdmin" style="margin-left: 16px" @change="toggleSuperAdmin">超级权限 *</el-checkbox>
      </div>
      <el-table :data="permissionCatalog" border size="small" max-height="560">
        <el-table-column prop="label" label="模块" width="140" fixed />
        <el-table-column label="权限">
          <template #default="{ row }">
            <el-checkbox
              v-for="p in row.permissions"
              :key="p.code"
              v-model="permMap[p.code]"
              :disabled="permDlg.superAdmin && p.code !== '*'"
              style="margin: 4px 18px 4px 0"
            >
              {{ p.action }}：{{ p.description }} <span class="perm-code">({{ p.code }})</span>
            </el-checkbox>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="permDlg.visible = false">取消</el-button>
        <el-button type="primary" @click="savePerms" :loading="permDlg.saving">保存矩阵</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

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

const dataScopeLabel = (value: string) => ({ all: '全部', workshop: '按车间', warehouse: '按仓库', instance: '按装备', self: '仅本人' } as any)[value] || '-'
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
  dlg.form = { ...row, password: '' }
  dlg.visible = true
}

const applyGroupDefault = (groupId: number) => {
  const group = roleGroups.value.find(g => g.id === groupId)
  if (group?.default_role_code && !dlg.isEdit) dlg.form.role_code = group.default_role_code
}

const saveUser = async () => {
  dlg.saving = true
  try {
    if (dlg.isEdit) {
      await Api.patch('/users/' + dlg.form.id, dlg.form)
      ElMessage.success('用户已更新')
    } else {
      await Api.post('/users', dlg.form)
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

const openGroupDialog = (row?: any) => {
  groupDlg.isEdit = !!row
  groupDlg.form = row ? { ...row } : {
    group_code: '', group_name: '', default_role_code: '', data_scope: 'all',
    default_home: '', description: '', is_active: true,
  }
  groupDlg.visible = true
}

const saveGroup = async () => {
  groupDlg.saving = true
  try {
    if (groupDlg.isEdit) await Api.patch('/role-groups/' + groupDlg.form.id, groupDlg.form)
    else await Api.post('/role-groups', groupDlg.form)
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
  await Promise.all([loadRoles(), loadRoleGroups(), loadPermissionCatalog()])
  await loadUsers()
})
</script>

<style scoped>
.page { padding: 16px 24px; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; }
.page-title { font-size: 20px; font-weight: 700; }
.sub { color: #667085; margin-top: 4px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.perm-code { color: #909399; font-size: 12px; }
</style>
