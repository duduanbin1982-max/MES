import moduleManifest from '../../../config/moduleManifest.json'

export type MenuItem = {
  key: string
  title: string
  to: string
  icon: string
  permission?: string | string[]
  roles?: string[]
}

export type MenuSection = {
  key: string
  title: string
  icon: string
  items: MenuItem[]
}

type ManifestModule = {
  key: string
  title: string
  path: string
  entry: string
  icon: string
  permission?: string | string[]
  roles?: string[]
}

type ManifestSection = {
  key: string
  title: string
  icon: string
  modules: ManifestModule[]
}

const SECTION_PERMISSION: Record<string, string> = {
  cockpit: 'report:read',
  project: 'equipment:read',
  design: 'process:read',
  execution: 'work_order:read',
  supply: 'material:read',
  quality: 'quality:read',
  service: 'equipment:read',
  cost: 'report:read',
  exception: 'work_order:read',
  system: 'user:read',
}

const MODULE_PERMISSION: Record<string, string | string[]> = {
  oee: 'equipment:read',
  schedule: 'work_order:read',
  bom: 'equipment:read',
  documents: 'document:read',
  eco: 'settings:read',
  'spc-design': 'quality:read',
  shopfloor: 'shopfloor:read',
  scan: 'shopfloor:read',
  'purchase-orders': 'purchase:read',
  suppliers: 'purchase:read',
  'kit-closure': 'pick:read',
  'purchase-followup': 'purchase:read',
  trace: ['material:read', 'work_order:read'],
  'critical-parts': 'equipment:read',
  'purchase-exceptions': 'purchase:read',
  'quality-exceptions': 'quality:read',
  'mdm-exceptions': 'settings:read',
  workstations: 'equipment:read',
  'coding-rules': 'settings:read',
  settings: 'settings:read',
  'system-diagnostics': 'settings:read',
  audit: 'audit:read',
}

const sections = moduleManifest.sections as ManifestSection[]

export const MENU_SECTIONS: MenuSection[] = sections.map((section) => ({
  key: section.key,
  title: section.title,
  icon: section.icon,
  items: section.modules.map((module) => ({
    key: module.key,
    title: module.title,
    to: module.entry,
    icon: module.icon,
    permission: module.permission || MODULE_PERMISSION[module.key] || SECTION_PERMISSION[section.key],
    roles: module.roles,
  })),
}))
