"use strict";
// middleware/apiPermissions.js
// API-level RBAC gate. Keep route handlers focused on business logic.

const { ApiError } = require("../app/errors");
const { hasPermission } = require("../app/permissions");

const PUBLIC_PATHS = new Set([
  "/auth/login",
  "/auth/refresh",
  "/health",
  "/workflow/definitions",
  "/debug/db-stats",
]);

function exact(path, methods, permissions) {
  return { test: (req) => path === req.path && methods.includes(req.method), permissions };
}

function match(pattern, methods, permissions) {
  return { test: (req) => pattern.test(req.path) && methods.includes(req.method), permissions };
}

const READ = ["GET"];
const WRITE = ["POST", "PUT", "PATCH", "DELETE"];

const RULES = [
  match(/^\/setup(?:\/.*)?$/, READ, ["settings:read", "report:read"]),
  match(/^\/help\/manual$/, READ, ["shopfloor:read", "document:read", "work_order:read", "material:read", "equipment:read", "report:read", "quality:read", "purchase:read", "settings:read", "user:read"]),
  match(/^\/shopfloor\/overview$/, READ, ["shopfloor:read"]),

  match(/^\/materials(?:\/\d+)?$/, READ, ["material:read"]),
  match(/^\/materials\/\d+\/units$/, READ, ["material:read"]),
  match(/^\/material_units(?:\/\d+)?$/, ["POST", "DELETE"], ["inventory:write", "material:write"]),
  match(/^\/inventory(?:\/alerts|\/lot_trace|\/stagnant)?$/, READ, ["inventory:read", "material:read"]),
  match(/^\/material_lots(?:\/\d+)?$/, READ, ["inventory:read", "material:read"]),
  match(/^\/material_lots\/receive$/, ["POST"], ["inventory:write", "material:write"]),
  match(/^\/material_lots\/\d+\/(?:split|merge)$/, ["POST"], ["inventory:write", "material:write"]),
  match(/^\/material_movements(?:\/batch)?$/, READ, ["inventory:read", "material:read"]),
  match(/^\/material_movements(?:\/batch)?$/, ["POST"], ["inventory:write", "material:write"]),
  match(/^\/inventory\/(?:allocate|release)$/, ["POST"], ["inventory:write", "material:write"]),
  match(/^\/key_components(?:\/long_leadtime)?$/, READ, ["material:read"]),

  match(/^\/work_orders(?:\/dispatchable)?$/, READ, ["work_order:read"]),
  match(/^\/work_orders\/\d+$/, READ, ["work_order:read"]),
  match(/^\/work_orders$/, ["POST"], ["work_order:write"]),
  match(/^\/work_orders\/\d+\/(?:operations|transit|welds|dispatch|report)$/, WRITE, ["work_order:write"]),
  match(/^\/work_orders\/\d+\/(?:kit-check|kit-check\/short|lots)$/, READ, ["work_order:read", "pick:read"]),
  match(/^\/work_orders\/\d+\/(?:pick-list|pick-history)$/, READ, ["pick:read"]),
  match(/^\/work_orders\/\d+\/(?:pick|return)$/, ["POST"], ["pick:write"]),

  match(/^\/shortages(?:\/\d+)?$/, READ, ["pick:read", "inventory:read"]),
  match(/^\/shortages\/\d+\/(?:follow-up|close)$/, ["POST"], ["pick:write"]),
  match(/^\/shortages\/\d+\/(?:assign|purchase-request)$/, ["POST"], ["purchase:write"]),
  match(/^\/work_orders\/\d+\/kit-sync$/, ["POST"], ["pick:write"]),

  match(/^\/documents(?:\/stats|\/pending-ack)?$/, READ, ["document:read"]),
  match(/^\/documents\/\d+(?:\/download|\/versions|\/acknowledgements)?$/, READ, ["document:read"]),
  match(/^\/documents\/\d+\/acknowledge$/, ["POST"], ["document:read"]),
  exact("/documents", ["POST"], ["document:write"]),
  match(/^\/documents\/\d+\/(?:issue|revoke)$/, ["PUT"], ["document:write"]),
  match(/^\/documents\/\d+$/, ["DELETE"], ["document:write"]),

  match(/^\/dashboard(?:\/alerts|\/delays|\/delays\/summary)?$/, READ, ["report:read"]),
  match(/^\/reports(?:\/.*)?$/, READ.concat(["POST", "PUT", "DELETE"]), ["report:read"]),

  match(/^\/equipment(?:\/live_status)?$/, READ, ["equipment:read"]),
  match(/^\/equipment_(?:types|models|subsystems)(?:\/\d+)?$/, READ, ["equipment:read"]),
  match(/^\/equipment_instances(?:\/\d+)?$/, READ, ["equipment:read"]),
  match(/^\/equipment_instances\/(?:code-preview|lifecycle-options)$/, READ, ["equipment:read"]),
  match(/^\/equipment_instance_templates(?:\/.*)?$/, READ, ["equipment:read"]),
  match(/^\/equipment_instance_templates(?:\/.*)?$/, WRITE, ["equipment:write"]),
  match(/^\/equipment_instances(?:\/\d+)?$/, WRITE, ["equipment:write"]),
  match(/^\/equipment_instances\/\d+\/(?:dashboard|overview|gantt|schedule|critical_path|subsystems|cross_subsystem_deps|parts_tree|parts_tree\/path|bom|bom\/health|bom\/levels|bom\/cost|bom\/validate|bom\/compare|material_alerts|kit_check|milestones|eco|cost_rollup|cost_rollup\/breakdown)$/, READ, ["equipment:read"]),
  match(/^\/equipment_instances\/\d+\/(?:schedule|lifecycle|freeze|archive|process_tree\/generate|bom|bom\/import|bom\/init-minimum|milestones\/auto-generate|eco)$/, WRITE, ["equipment:write"]),
  match(/^\/milestones\/\d+$/, WRITE, ["equipment:write"]),
  match(/^\/bom\/\d+$/, WRITE, ["equipment:write"]),
  match(/^\/instance_eco\/\d+$/, ["PUT"], ["equipment:write"]),
  match(/^\/instance_eco\/\d+\/impact$/, READ, ["equipment:read"]),
  match(/^\/resources(?:\/.*)?$/, READ, ["equipment:read"]),
  match(/^\/resources(?:\/.*)?$/, WRITE, ["equipment:write"]),
  match(/^\/schedule(?:\/.*)?$/, READ, ["equipment:read"]),
  match(/^\/schedule(?:\/.*)?$/, WRITE, ["equipment:write"]),

  match(/^\/process-master(?:\/.*)?$/, READ, ["process:read"]),
  match(/^\/process-master(?:\/.*)?$/, WRITE, ["process:write"]),
  match(/^\/process-route(?:\/.*)?$/, READ, ["process:read"]),
  match(/^\/process(?:\/.*)?$/, READ, ["process:read"]),
  match(/^\/process-route(?:\/.*)?$/, WRITE, ["process:write"]),
  match(/^\/process(?:\/.*)?$/, WRITE, ["process:write"]),
  match(/^\/process_nodes(?:\/.*)?$/, READ, ["process:read"]),
  match(/^\/process_nodes(?:\/.*)?$/, WRITE, ["process:write"]),
  match(/^\/process_dependencies(?:\/.*)?$/, WRITE, ["process:write"]),
  match(/^\/process-hours(?:\/.*)?$/, READ, ["work_order:read"]),
  match(/^\/work-reports(?:\/.*)?$/, READ, ["work_order:read"]),
  match(/^\/work-reports(?:\/.*)?$/, ["POST"], ["work_order:write"]),

  match(/^\/qc(?:\/.*)?$/, READ, ["quality:read"]),
  match(/^\/qc(?:\/.*)?$/, WRITE, ["quality:write"]),
  match(/^\/qc_inspections(?:\/.*)?$/, READ, ["quality:read"]),
  match(/^\/qc_inspections(?:\/.*)?$/, WRITE, ["quality:write"]),
  match(/^\/spc(?:\/.*)?$/, READ, ["quality:read"]),
  match(/^\/spc(?:\/.*)?$/, WRITE, ["quality:write"]),

  match(/^\/supplier-collab(?:\/.*)?$/, READ, ["purchase:read", "quality:read"]),
  match(/^\/supplier-collab(?:\/.*)?$/, WRITE, ["purchase:write", "quality:write"]),
  match(/^\/purchase(?:\/.*)?$/, READ, ["purchase:read"]),
  match(/^\/purchase(?:\/.*)?$/, WRITE, ["purchase:write"]),
  match(/^\/purchase_orders(?:\/.*)?$/, READ, ["purchase:read"]),
  match(/^\/purchase_orders(?:\/.*)?$/, WRITE, ["purchase:write"]),
  match(/^\/suppliers(?:\/.*)?$/, READ, ["purchase:read"]),
  match(/^\/suppliers(?:\/.*)?$/, WRITE, ["purchase:write"]),

  match(/^\/delivery(?:\/.*)?$/, READ, ["report:read"]),
  match(/^\/exceptions(?:\/.*)?$/, READ, ["report:read"]),
  match(/^\/exceptions(?:\/.*)?$/, WRITE, ["work_order:write", "quality:write"]),
  match(/^\/mdm(?:\/.*)?$/, READ, ["settings:read"]),
  match(/^\/mdm(?:\/.*)?$/, WRITE, ["settings:write"]),

  match(/^\/andon(?:\/.*)?$/, READ, ["work_order:read"]),
  match(/^\/andon(?:\/.*)?$/, WRITE, ["work_order:write"]),
  match(/^\/iot(?:\/.*)?$/, READ, ["equipment:read"]),
  match(/^\/iot(?:\/.*)?$/, WRITE, ["equipment:write"]),
  match(/^\/dt(?:\/.*)?$/, READ, ["equipment:read"]),
  match(/^\/dt(?:\/.*)?$/, WRITE, ["equipment:write"]),
  match(/^\/plm(?:\/.*)?$/, READ, ["document:read"]),
  match(/^\/plm(?:\/.*)?$/, WRITE, ["document:write"]),
  match(/^\/ai(?:\/.*)?$/, READ.concat(["POST"]), ["report:read"]),
  match(/^\/erp(?:\/.*)?$/, READ.concat(["POST", "PUT"]), ["report:read"]),
  match(/^\/oee(?:\/.*)?$/, READ, ["report:read"]),
  match(/^\/oee(?:\/.*)?$/, WRITE, ["equipment:write"]),

  match(/^\/labor(?:\/.*)?$/, READ, ["user:read"]),
  match(/^\/labor(?:\/.*)?$/, WRITE, ["user:admin"]),
  match(/^\/field-service(?:\/.*)?$/, READ, ["equipment:read"]),
  match(/^\/field-service(?:\/.*)?$/, WRITE, ["equipment:write"]),
  match(/^\/field_service(?:\/.*)?$/, READ, ["equipment:read"]),
  match(/^\/field_service(?:\/.*)?$/, WRITE, ["equipment:write"]),
  match(/^\/spare_parts(?:\/.*)?$/, READ, ["equipment:read"]),
  match(/^\/spare_parts(?:\/.*)?$/, WRITE, ["equipment:write"]),
  match(/^\/maintenance_plans(?:\/.*)?$/, READ, ["equipment:read"]),
  match(/^\/maintenance_plans(?:\/.*)?$/, WRITE, ["equipment:write"]),

  match(/^\/(?:critical-parts|supervision-logs|purchase-tracking|contract-milestones|project-payments|project-summary|acceptance-checklists|fault-knowledge)(?:\/.*)?$/, READ, ["equipment:read"]),
  match(/^\/(?:critical-parts|supervision-logs|purchase-tracking|contract-milestones|project-payments|project-summary|acceptance-checklists|fault-knowledge)(?:\/.*)?$/, WRITE, ["equipment:write"]),
  match(/^\/trace(?:\/.*)?$/, READ, ["material:read", "work_order:read"]),

  match(/^\/settings(?:-|\/|$).*$/, READ, ["settings:read"]),
  match(/^\/settings(?:-|\/|$).*$/, WRITE, ["settings:write"]),
  match(/^\/permissions(?:\/.*)?$/, READ, ["user:read"]),
  match(/^\/role-groups(?:\/.*)?$/, READ, ["user:read"]),
  match(/^\/role-groups(?:\/.*)?$/, WRITE, ["user:admin"]),
  match(/^\/roles(?:\/.*)?$/, READ, ["user:read"]),
  match(/^\/roles(?:\/.*)?$/, WRITE, ["user:admin"]),
  match(/^\/users(?:\/.*)?$/, READ, ["user:read"]),
  match(/^\/users(?:\/.*)?$/, WRITE, ["user:admin"]),
  match(/^\/audit(?:\/.*)?$/, READ, ["audit:read"]),
  match(/^\/workflow(?:\/.*)?$/, READ, ["work_order:read"]),
  match(/^\/workflow(?:\/.*)?$/, WRITE, ["work_order:write"]),
];

function canAccess(userPerms, permissions) {
  return permissions.some((permission) => hasPermission(userPerms, permission));
}

function apiPermissionMiddleware(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (req.path.startsWith("/auth/")) return next();

  const user = req.user || {};
  const userPerms = user.permissions || [];
  const rule = RULES.find((entry) => entry.test(req));

  if (!rule) {
    if (user.role === "warehouse") {
      return next(ApiError.forbidden("仓库员无权访问该接口", {
        role: user.role,
        method: req.method,
        path: req.originalUrl,
      }));
    }
    return next();
  }

  if (!canAccess(userPerms, rule.permissions)) {
    return next(ApiError.forbidden("权限不足, 需要: " + rule.permissions.join(" / "), {
      role: user.role,
      method: req.method,
      path: req.originalUrl,
      need: rule.permissions,
      have: userPerms.filter((permission) => permission !== "*").slice(0, 10),
    }));
  }

  next();
}

module.exports = { apiPermissionMiddleware };
