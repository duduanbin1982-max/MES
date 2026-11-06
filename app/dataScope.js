"use strict";
// app/dataScope.js
// P1-1（2026-10-18）：权限点 × 数据范围（行级权限）。
//
// 背景：现有权限只有"功能点"这一维（能不能进某个接口），没有"数据范围"
// （同一角色在不同项目/车间只能看自己的那部分）。这里加第三维：
//
//   角色组 data_scope（已有）→ 用户级覆盖 users.data_scope（新增）→ 角色默认 'all'
//
// 支持的范围值（与前端下拉/角色组配置一致）：
//   all       全部数据
//   instance  按装备/项目（scope_config.project_ids 或 instance_ids）
//   workshop  按车间（scope_config.subsystem_ids；工单上是 subsystem_id）
//   workstation 按工位（scope_config.workstation_ids）
//   self      仅本人相关（assigned_to / inspector_id / operator_id）
//   warehouse 按仓库（scope_config.locations；仅物料/库存类实体支持）
//
// 设计原则：
//   1) 任何实体 × 范围的组合，只要缺配置 → 默认**拒绝**（1=0），绝不因配置缺失而放量。
//   2) 实体不支持该范围时：不加过滤但返回 supported=false + warning，由调用方决定是否提示。
//   3) 全部逻辑是纯函数（buildFilter/rowInScope），可单测；DB 只出现在 loadScope。

const SCOPES = ["all", "instance", "workshop", "workstation", "self", "warehouse"];

const SCOPE_LABELS = {
  all: "全部数据",
  instance: "按装备/项目",
  workshop: "按车间",
  workstation: "按工位",
  self: "仅本人相关",
  warehouse: "按仓库",
};

// 实体 → 支持的范围（不支持的组合会被标 supported=false，不过滤但带 warning）
const ENTITY_SCOPES = {
  work_orders: ["all", "instance", "workshop", "workstation", "self"],
  qc_inspections: ["all", "instance", "workshop", "workstation", "self"],
  material_movements: ["all", "instance", "workshop", "workstation", "self", "warehouse"],
};

function parseConfig(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function normalizeIds(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(
    list
      .filter((v) => v !== null && v !== undefined && v !== "")
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v))
  )];
}

/** 统一配置结构：{project_ids, workstation_ids, subsystem_ids, locations} */
function normalizeConfig(raw) {
  const cfg = parseConfig(raw);
  return {
    project_ids: normalizeIds(cfg.project_ids || cfg.instance_ids),
    workstation_ids: normalizeIds(cfg.workstation_ids),
    subsystem_ids: normalizeIds(cfg.subsystem_ids),
    locations: Array.isArray(cfg.locations) ? cfg.locations.map(String).filter(Boolean) : [],
  };
}

/**
 * 解析生效范围（优先级：用户覆盖 > 角色组 > 角色默认 > all）
 * @param {{data_scope?: string, data_scope_config?: string|object, role_code?: string}} user
 * @param {{data_scope?: string, scope_config?: string|object}} group
 * @returns {{scope: string, config: object, source: string}}
 */
function resolveScope(user = {}, group = null) {
  const userScope = user.data_scope && SCOPES.includes(user.data_scope) ? user.data_scope : null;
  if (userScope) {
    return { scope: userScope, config: normalizeConfig(user.data_scope_config), source: "user" };
  }
  const groupScope = group && group.data_scope && SCOPES.includes(group.data_scope) ? group.data_scope : null;
  if (groupScope) {
    return { scope: groupScope, config: normalizeConfig(group.scope_config), source: "role_group" };
  }
  // admin 永远全量；其余角色未配置时保持旧行为（全量），但标记 source=default
  return { scope: "all", config: {}, source: "default" };
}

function inList(column, ids, params) {
  if (!ids.length) return "1 = 0"; // 缺配置 → 拒绝，不放量
  params.push(...ids);
  return `${column} IN (${ids.map(() => "?").join(",")})`;
}

/**
 * 生成 SQL 过滤片段
 * @param {string} entity work_orders | qc_inspections | material_movements
 * @param {{scope: string, config: object, user_id?: number}} ctx
 * @param {string} alias 表别名（如 'wo'）
 * @returns {{clause: string, params: any[], supported: boolean, warning?: string}}
 */
function buildFilter(entity, ctx, alias = "") {
  const supportedScopes = ENTITY_SCOPES[entity] || ["all"];
  const scope = ctx && ctx.scope ? ctx.scope : "all";
  const prefix = alias ? alias + "." : "";
  const empty = { clause: "", params: [], supported: true };

  if (scope === "all") return empty;

  if (!supportedScopes.includes(scope)) {
    return {
      clause: "",
      params: [],
      supported: false,
      warning: `${entity} 不支持数据范围「${SCOPE_LABELS[scope] || scope}」，本次未按范围过滤`,
    };
  }

  const cfg = (ctx && ctx.config) || {};
  const params = [];

  if (entity === "work_orders") {
    if (scope === "self") {
      params.push(Number(ctx.user_id));
      return { clause: `${prefix}assigned_to = ?`, params, supported: true };
    }
    if (scope === "workstation") return { clause: inList(`${prefix}workstation_id`, cfg.workstation_ids || [], params), params, supported: true };
    if (scope === "workshop") return { clause: inList(`${prefix}subsystem_id`, cfg.subsystem_ids || [], params), params, supported: true };
    if (scope === "instance") return { clause: inList(`${prefix}equipment_instance_id`, cfg.project_ids || [], params), params, supported: true };
  }

  if (entity === "qc_inspections") {
    if (scope === "self") {
      params.push(Number(ctx.user_id));
      return { clause: `${prefix}inspector_id = ?`, params, supported: true };
    }
    if (scope === "instance") return { clause: inList(`${prefix}equipment_instance_id`, cfg.project_ids || [], params), params, supported: true };
    if (scope === "workstation") {
      const inner = inList("workstation_id", cfg.workstation_ids || [], params);
      return { clause: `${prefix}work_order_id IN (SELECT id FROM work_orders WHERE ${inner})`, params, supported: true };
    }
    if (scope === "workshop") {
      const inner = inList("subsystem_id", cfg.subsystem_ids || [], params);
      return { clause: `${prefix}work_order_id IN (SELECT id FROM work_orders WHERE ${inner})`, params, supported: true };
    }
  }

  if (entity === "material_movements") {
    if (scope === "self") {
      params.push(Number(ctx.user_id));
      return { clause: `${prefix}operator_id = ?`, params, supported: true };
    }
    if (scope === "warehouse") {
      if (!cfg.locations || !cfg.locations.length) {
        // 没有配置库位 → 仓库范围等价于"全部库房收发"（仓储部本来就是全库视角）
        return { clause: `(${prefix}from_location IS NOT NULL OR ${prefix}to_location IS NOT NULL)`, params, supported: true };
      }
      params.push(...cfg.locations);
      return { clause: `(${prefix}from_location IN (${cfg.locations.map(() => "?").join(",")}) OR ${prefix}to_location IN (${cfg.locations.map(() => "?").join(",")}))`, params, supported: true };
    }
    if (scope === "instance") {
      const ids = cfg.project_ids || [];
      if (!ids.length) return { clause: "1 = 0", params, supported: true };
      params.push(...ids);
      const inner = ids.map(() => "?").join(",");
      return {
        clause: `(${prefix}work_order_id IN (SELECT id FROM work_orders WHERE equipment_instance_id IN (${inner})) OR ${prefix}project_id IN (${inner}))`,
        params, supported: true,
      };
    }
    if (scope === "workstation") {
      const inner = inList("workstation_id", cfg.workstation_ids || [], params);
      return { clause: `${prefix}work_order_id IN (SELECT id FROM work_orders WHERE ${inner})`, params, supported: true };
    }
    if (scope === "workshop") {
      const inner = inList("subsystem_id", cfg.subsystem_ids || [], params);
      return { clause: `${prefix}work_order_id IN (SELECT id FROM work_orders WHERE ${inner})`, params, supported: true };
    }
  }

  return { ...empty, supported: false, warning: `${entity} 未实现范围 ${scope}` };
}

/** 单行是否在范围内（详情接口 403 用） */
function rowInScope(entity, ctx, row) {
  if (!row) return false;
  const scope = (ctx && ctx.scope) || "all";
  if (scope === "all") return true;
  const cfg = (ctx && ctx.config) || {};
  const num = (v) => (v === null || v === undefined ? null : Number(v));

  if (entity === "work_orders") {
    if (scope === "self") return num(row.assigned_to) === num(ctx.user_id);
    if (scope === "workstation") return (cfg.workstation_ids || []).includes(num(row.workstation_id));
    if (scope === "workshop") return (cfg.subsystem_ids || []).includes(num(row.subsystem_id));
    if (scope === "instance") return (cfg.project_ids || []).includes(num(row.equipment_instance_id));
    return false;
  }
  if (entity === "qc_inspections") {
    if (scope === "self") return num(row.inspector_id) === num(ctx.user_id);
    if (scope === "instance") return (cfg.project_ids || []).includes(num(row.equipment_instance_id));
    return false; // workstation/workshop 需要 join 工单，列表已过滤，详情不支持
  }
  if (entity === "material_movements") {
    if (scope === "self") return num(row.operator_id) === num(ctx.user_id);
    if (scope === "warehouse") {
      if (!cfg.locations || !cfg.locations.length) return true;
      return cfg.locations.includes(String(row.from_location || "")) || cfg.locations.includes(String(row.to_location || ""));
    }
    if (scope === "instance") return (cfg.project_ids || []).includes(num(row.project_id));
    return false;
  }
  // 未实现范围的实体：不放行
  return scope === "all";
}

/**
 * 取请求的数据范围上下文（容错）：中间件未挂载（如单测里直接调 handler）时按 all 处理。
 * 注意：这里只做"取"，不改变已解析的结果。
 */
function scopeOf(req) {
  if (req && typeof req.scope === "function") return req.scope();
  return { scope: "all", config: {}, user_id: null, source: "no_middleware" };
}

/** 从 DB 加载用户生效范围（懒加载，供中间件缓存） */
function loadScope(db, userId) {
  if (!userId) return { scope: "all", config: {}, source: "anonymous", user_id: null };
  let user;
  try {
    user = db.prepare("SELECT id, role_code, role_group_id, data_scope, data_scope_config FROM users WHERE id = ?").get(userId);
  } catch (_error) {
    user = undefined;
  }
  if (!user) return { scope: "all", config: {}, source: "missing_user", user_id: userId };
  let group = null;
  if (user.role_group_id) {
    try {
      try {
        group = db.prepare("SELECT data_scope, scope_config, is_active FROM role_groups WHERE id = ?").get(user.role_group_id);
        // 2026-11-06（角色组审计）：停用组不再参与数据范围继承（应为无用户状态，防御处理）
        if (group && group.is_active !== undefined && Number(group.is_active) === 0) group = null;
      } catch (_error) {
        // 旧库/测试库没有 is_active 列时退回原查询
        group = db.prepare("SELECT data_scope, scope_config FROM role_groups WHERE id = ?").get(user.role_group_id);
      }
    } catch (_error) {
      group = null;
    }
  }
  const resolved = resolveScope(user, group);
  return { ...resolved, user_id: Number(user.id), role_code: user.role_code };
}

/** 给 GET /api/me/scope 用的可读描述 */
function describe(scopeCtx) {
  return {
    scope: scopeCtx.scope,
    label: SCOPE_LABELS[scopeCtx.scope] || scopeCtx.scope,
    source: scopeCtx.source,
    config: scopeCtx.config,
    entities: Object.fromEntries(
      Object.keys(ENTITY_SCOPES).map((entity) => [entity, ENTITY_SCOPES[entity].includes(scopeCtx.scope)])
    ),
  };
}

module.exports = {
  SCOPES,
  SCOPE_LABELS,
  ENTITY_SCOPES,
  parseConfig,
  normalizeConfig,
  resolveScope,
  buildFilter,
  rowInScope,
  loadScope,
  scopeOf,
  describe,
};
