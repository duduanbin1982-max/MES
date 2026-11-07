<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div>
        <div class="page-title"><el-icon><User /></el-icon> 用户与权限管理</div>
        <div class="sub">用户 → 角色组/部门 → 角色 → 权限矩阵；角色组负责批量归属和默认首页，角色负责具体权限。</div>
      </div>
      <el-button type="primary" @click="openCreate">+ 新建用户</el-button>
    </PageToolbar>

    <el-alert v-if="myScope" :closable="false" type="info" style="margin-bottom: 12px"
      :title="'当前登录用户数据范围：' + myScope.label + (myScope.source === 'role_group' ? '（继承角色组）' : myScope.source === 'user' ? '（用户级覆盖）' : '（默认）')" />

    <el-tabs v-model="tab">
      <el-tab-pane label="用户列表" name="users">
        <el-card>
          <div class="user-toolbar">
            <el-input v-model="userFilter.q" placeholder="搜索用户名/姓名/手机" clearable style="width:220px" @keyup.enter="loadUsers" />
            <el-select v-model="userFilter.role_code" placeholder="全部角色" clearable style="width:150px">
              <el-option v-for="r in roles" :key="r.code" :label="r.name" :value="r.code" />
            </el-select>
            <el-select v-model="userFilter.is_active" placeholder="全部状态" clearable style="width:120px">
              <el-option label="启用" value="true" />
              <el-option label="禁用" value="false" />
            </el-select>
            <el-button type="primary" @click="loadUsers">查询</el-button>
            <el-button @click="resetUserFilter">重置</el-button>
            <span class="muted">共 {{ total }} 人</span>
          </div>
          <el-table :data="users" stripe v-loading="loading" size="small">
            <el-table-column prop="id" label="ID" width="60" />
            <el-table-column prop="username" label="用户名" width="120" />
            <el-table-column prop="full_name" label="姓名" width="120" />
            <el-table-column prop="group_name" label="角色组/部门" width="130">
              <template #default="{ row }"><el-tag v-if="row.group_name" size="small">{{ row.group_name }}</el-tag><span v-else>-</span></template>
            </el-table-column>
            <el-table-column prop="role_name" label="角色" width="120" />
            <el-table-column prop="role_code" label="角色编码" width="110" />
            <el-table-column label="数据范围" width="150">
              <template #default="{ row }">
                <el-tag size="small" :type="row.data_scope_override ? 'warning' : 'info'">
                  {{ dataScopeLabel(row.effective_data_scope || row.data_scope) }}
                </el-tag>
                <el-tag v-if="row.data_scope_override" size="small" type="danger" style="margin-left:4px">覆盖</el-tag>
              </template>
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
              <span><el-icon><PriceTag /></el-icon> 角色组/部门</span>
              <div style="display:flex;gap:8px;align-items:center">
              <el-checkbox v-model="roleGroupIncludeDeleted" @change="loadRoleGroups">显示已删除</el-checkbox>
              <el-button type="primary" size="small" @click="openGroupDialog()">+ 新建角色组</el-button>
            </div>
            </div>
          </template>
          <el-table :data="roleGroups" stripe size="small">
            <el-table-column prop="group_code" label="编码" width="120" />
            <el-table-column prop="group_name" label="名称" width="130" />
            <el-table-column prop="default_role_name" label="默认角色" width="120" />
            <el-table-column label="数据范围" width="120"><template #default="{ row }">{{ dataScopeLabel(row.data_scope) }}</template></el-table-column>
            <el-table-column label="范围配置" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">
                <code v-if="row.scope_config && Object.keys(row.scope_config).length">{{ JSON.stringify(row.scope_config) }}</code>
                <span v-else style="color: var(--el-color-info)">（空）</span>
              </template>
            </el-table-column>
            <el-table-column prop="default_home" label="默认首页" width="180" />
            <el-table-column prop="user_count" label="用户数" width="80" />
            <el-table-column prop="description" label="说明" min-width="220" />
            <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.deleted_at ? 'danger' : row.is_active ? 'success' : 'info'" size="small">{{ row.deleted_at ? '已删除' : row.is_active ? '启用' : '停用' }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="300" fixed="right">
              <template #default="{ row }">
                <template v-if="row.deleted_at">
                  <el-button size="small" type="success" @click="restoreRoleGroup(row)">恢复</el-button>
                  <el-button size="small" type="danger" @click="hardDeleteRoleGroup(row)">彻底删除</el-button>
                </template>
                <template v-else>
                  <el-button size="small" @click="openGroupDialog(row)">编辑</el-button>
                  <el-button size="small" @click="openGroupMembers(row)">成员</el-button>
                  <el-button size="small" type="primary" plain @click="openAssignUsers(row)">分配用户</el-button>
                  <el-button size="small" type="danger" @click="deleteRoleGroup(row)">删除</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="权限矩阵" name="matrix">
        <el-alert v-if="permissionRequests.length" type="warning" :closable="false" show-icon style="margin-bottom: 12px">
          <template #title>有 {{ permissionRequests.length }} 条权限变更待另一名管理员审批（双人复核）</template>
          <el-table :data="permissionRequests" size="small" border style="margin-top: 8px">
            <el-table-column prop="role_code" label="角色" width="140" />
            <el-table-column prop="role_name" label="角色名" width="120" />
            <el-table-column prop="requested_by_name" label="申请人" width="110" />
            <el-table-column prop="requested_at" label="申请时间" width="170" />
            <el-table-column label="变更" min-width="180">
              <template #default="{ row }">
                {{ (JSON.parse(row.before_json || '[]')).length }} → {{ (JSON.parse(row.after_json || '[]')).length }} 项
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" align="center">
              <template #default="{ row }">
                <el-button size="small" type="success" link @click="approvePermissionRequest(row)">通过</el-button>
                <el-button size="small" type="danger" link @click="rejectPermissionRequest(row)">驳回</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-alert>
        <el-card style="margin-bottom: 16px">
          <template #header>
            <div class="card-head">
              <span><el-icon><Key /></el-icon> 角色管理 / 权限矩阵</span>
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
          <template #header><span><el-icon><Reading /></el-icon> 权限目录</span></template>
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
        <el-form-item label="密码"><el-input v-model="dlg.form.password" type="password" show-password :placeholder="dlg.isEdit ? '留空不修改' : '必填，至少 8 位'" /><div style="font-size:12px;color:var(--el-color-info);margin-top:4px">密码至少 8 位；禁用/改角色/改密码后该用户会被强制重新登录</div></el-form-item>
        <el-form-item label="姓名" required><el-input v-model="dlg.form.full_name" /></el-form-item>
        <el-form-item label="角色组">
          <el-select v-model="dlg.form.role_group_id" clearable style="width: 100%" @change="applyGroupDefault">
            <el-option v-for="g in activeRoleGroups" :key="g.id" :label="g.group_name + ' / ' + g.group_code" :value="g.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色" required>
          <el-select v-model="dlg.form.role_code" style="width: 100%">
            <el-option v-for="r in roles" :key="r.code" :label="r.code + ' - ' + r.name" :value="r.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="手机"><el-input v-model="dlg.form.phone" /></el-form-item>
        <el-form-item label="数据范围">
          <el-select v-model="dlg.form.data_scope" clearable placeholder="继承角色组" style="width: 100%">
            <el-option v-for="o in dataScopeOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
          <div style="font-size: 12px; color: var(--el-color-info); margin-top: 4px">留空 = 继承角色组的数据范围；填写后按"用户级覆盖"生效</div>
        </el-form-item>
        <el-form-item v-if="scopeNeedsConfig(dlg.form.data_scope)" label="范围配置">
          <el-input v-model="dlg.form.data_scope_config" type="textarea" :rows="2"
            placeholder='JSON，如 {"project_ids":[1]} / {"subsystem_ids":[2]} / {"workstation_ids":[3]} / {"locations":["主仓库-A-01"]}' />
        </el-form-item>
        <el-form-item label="状态"><el-switch v-model="dlg.form.is_active" active-text="启用" inactive-text="禁用" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" @click="saveUser" :loading="dlg.saving">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="groupMembers.visible" title="角色组成员" width="620px">
      <div v-if="groupMembers.group" style="margin-bottom: 10px">
        角色组：<strong>{{ groupMembers.group.group_name }}（{{ groupMembers.group.group_code }}）</strong>
      </div>
      <el-table :data="groupMembers.items" v-loading="groupMembers.loading" size="small" border max-height="420">
        <el-table-column prop="username" label="用户名" width="130" />
        <el-table-column prop="full_name" label="姓名" width="120" />
        <el-table-column prop="role_name" label="角色" width="120" />
        <el-table-column label="状态" width="80"><template #default="{ row }">{{ row.is_active ? '启用' : '禁用' }}</template></el-table-column>
        <el-table-column prop="last_login" label="最后登录" width="160" />
      </el-table>
      <template #footer><el-button @click="groupMembers.visible = false">关闭</el-button></template>
    </el-dialog>

    <el-dialog v-model="groupAssign.visible" title="批量归属用户" width="520px">
      <div v-if="groupAssign.group" style="margin-bottom: 10px">
        角色组：<strong>{{ groupAssign.group.group_name }}（{{ groupAssign.group.group_code }}）</strong>
      </div>
      <el-select v-model="groupAssign.userIds" multiple filterable placeholder="选择用户" style="width: 100%">
        <el-option v-for="user in users" :key="user.id" :label="`${user.full_name || user.username}（${user.username} / ${user.role_name || user.role_code}）`" :value="user.id" />
      </el-select>
      <div style="font-size:12px;color:var(--el-color-info);margin-top:8px">归属后用户的数据范围将继承该角色组（用户级覆盖优先）；停用角色组不可分配。</div>
      <template #footer>
        <el-button @click="groupAssign.visible = false">取消</el-button>
        <el-button type="primary" :loading="groupAssign.saving" @click="submitAssignUsers">确定归属</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="groupDlg.visible" :title="groupDlg.isEdit ? '编辑角色组' : '新建角色组'" width="560px">
      <el-form :model="groupDlg.form" label-width="100px">
        <el-form-item label="组编码" required><el-input v-model="groupDlg.form.group_code" :disabled="groupDlg.isEdit" placeholder="小写字母开头，如 production / warehouse" /><div style="font-size:12px;color:var(--el-color-info);margin-top:4px">只能包含小写字母/数字/下划线，2-32 位；默认角色必须存在</div></el-form-item>
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
        <el-form-item v-if="scopeNeedsConfig(groupDlg.form.data_scope)" label="范围配置">
          <el-input v-model="groupDlg.form.scope_config" type="textarea" :rows="2"
            placeholder='JSON，如 {"project_ids":[1]} / {"subsystem_ids":[2]} / {"workstation_ids":[3]}' />
          <div style="font-size:12px;color:var(--el-color-info);margin-top:4px">支持键：project_ids / instance_ids / subsystem_ids / workstation_ids / locations；ID 必须为正整数</div>
        </el-form-item>
        <el-form-item label="默认首页"><el-input v-model="groupDlg.form.default_home" placeholder="/delivery 或 /shopfloor?tab=pick" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="groupDlg.form.description" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="groupDlg.form.is_active" active-text="启用" inactive-text="停用" /></el-form-item>
        <el-form-item v-if="groupDlg.isEdit" label="批量调整">
          <el-checkbox v-model="groupDlg.form.apply_default_role_to_users">保存后把该组已归属用户的角色调整为默认角色（会强制用户重新登录）</el-checkbox>
        </el-form-item>
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
        <el-form-item label="角色名称" required><el-input v-model="roleDlg.form.role_name" placeholder="如 计划员 / 仓库主管" @input="onRoleNameInput" /></el-form-item>
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
import { useUserManagementPage } from '../composables/useUserManagementPage'

const {
  tab,
  users,
  total,
  userFilter,
  resetUserFilter,
  loadUsers,
  roles,
  roleGroups,
  loadRoleGroups,
  activeRoleGroups,
  groupAssign,
  groupMembers,
  roleGroupIncludeDeleted,
  openGroupMembers,
  restoreRoleGroup,
  hardDeleteRoleGroup,
  openAssignUsers,
  submitAssignUsers,
  permissionCatalog,
  permissionRequests,
  approvePermissionRequest,
  rejectPermissionRequest,
  deleteRoleGroup,
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
  previewPerms,
  openCreate,
  editUser,
  applyGroupDefault,
  saveUser,
  delUser,
  onRoleNameInput,
  openGroupDialog,
  saveGroup,
  openRoleDialog,
  copyRole,
  saveRole,
  deleteRole,
  editPerms,
  toggleSuperAdmin,
  savePerms } = useUserManagementPage()
</script>

<style scoped>
.page { padding: 16px 24px; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; }
.page-title { font-size: 20px; font-weight: 700; }
.sub { color: var(--color-text-muted); margin-top: 4px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.perm-code { color: var(--el-color-info); font-size: 12px; }
</style>
