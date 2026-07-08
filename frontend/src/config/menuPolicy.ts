// frontend/src/config/menuPolicy.ts
import type { MenuItem, MenuSection } from './menuCatalog'

const WAREHOUSE_MENU_KEYS = new Set([
  'shopfloor',
  'work-orders',
  'materials',
  'inventory',
  'material-alerts',
  'kit-closure',
  'documents',
])

function allowedForRole(item: MenuItem, role?: string) {
  if (role === 'warehouse') return WAREHOUSE_MENU_KEYS.has(item.key)
  return !item.roles || item.roles.includes(role || '')
}

function allowedByPermission(item: MenuItem, hasAnyPerm: (...permissions: string[]) => boolean) {
  if (!item.permission) return true
  const needs = Array.isArray(item.permission) ? item.permission : [item.permission]
  return hasAnyPerm(...needs)
}

export function filterMenuSections(
  sections: MenuSection[],
  context: { role?: string; hasAnyPerm: (...permissions: string[]) => boolean },
) {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => allowedForRole(item, context.role) && allowedByPermission(item, context.hasAnyPerm)),
    }))
    .filter((section) => section.items.length > 0)
}
