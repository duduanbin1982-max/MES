const { EQUIPMENT_LIFECYCLE_META } = require("../../app/domain/statusCatalog");

const LIFE_CYCLE = Object.entries(EQUIPMENT_LIFECYCLE_META).map(([value, meta]) => ({
  value,
  label: meta.label,
  tag: meta.tag,
}));

const DEFAULT_MILESTONES = [
  ["S1", "设计冻结", 10],
  ["S2", "长周期采购", 20],
  ["S3", "部件制造", 30],
  ["S4", "总装", 40],
  ["S5", "联调测试", 50],
  ["S6", "客户验收", 60],
  ["S7", "交付发运", 70],
  ["S8", "运维移交", 80],
];

const DEFAULT_DOC_FOLDERS = ["合同", "BOM", "图纸", "工艺", "质检", "验收", "运维"];

const TEMPLATE_SCOPE_OPTIONS = [
  { key: "milestones", label: "里程碑" },
  { key: "bom_shell", label: "BOM 空壳" },
  { key: "bom", label: "完整 BOM" },
  { key: "process", label: "工艺路线" },
  { key: "doc_dirs", label: "文档目录" },
];

const EMPTY_TEMPLATE_SCOPE = { milestones: true, bom_shell: true, bom: false, process: false, doc_dirs: true };
const INSTANCE_TEMPLATE_SCOPE = { milestones: true, bom_shell: false, bom: true, process: true, doc_dirs: true };

module.exports = {
  LIFE_CYCLE,
  DEFAULT_MILESTONES,
  DEFAULT_DOC_FOLDERS,
  TEMPLATE_SCOPE_OPTIONS,
  EMPTY_TEMPLATE_SCOPE,
  INSTANCE_TEMPLATE_SCOPE,
};
