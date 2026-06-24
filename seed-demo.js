// seed-demo.js
// TBM-MES 一键演示数据
// 1. 创建项目 TBM-2026-001 (Ø4m 土压平衡)
// 2. 自动生成 S1-S10 10 个里程碑
// 3. 创建 34 个物料 + 11 个关键外购件
// 4. 创建 9 大子系统 BOM 树 (67 节点, 5 级)
// 适用: reset-to-demo.sh / 初始部署 / 演示前
// Author: 三狗子 | Date: 2026-06-18

const db = require('/home/dubin/factory-mes/db');

console.log('=== TBM-MES 演示数据初始化 ===\n');

// ============================================================
// 1) 项目
// ============================================================
console.log('[1/4] 创建示例项目 TBM-2026-001...');
let projectId = db.prepare('SELECT id FROM projects WHERE project_code = ?').get('TBM-2026-001')?.id;
if (projectId) {
  console.log(`  项目已存在 (id=${projectId}), 跳过`);
} else {
  const r = db.prepare(`INSERT INTO projects
    (project_code, project_name, customer_name, customer_contact, site_location,
     contract_no, tbm_model_id, start_date, planned_start, planned_end, contract_amount, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'TBM-2026-001', '郑州地铁 4 号线 4m 盾构机', '郑州地铁集团', '王工 13800138000',
    '郑州地铁 4 号线 7 标段', 'ZZ-DT4-2026-001', 1, '2026-06-15', '2026-07-01', '2026-12-31', 1800,
    '首台示范机 - 4m 土压平衡盾构机'
  );
  projectId = r.lastInsertRowid;
  console.log(`  ✓ 项目已创建 (id=${projectId})`);
}

// ============================================================
// 2) 里程碑
// ============================================================
console.log('\n[2/4] 自动生成 S1-S10 10 个里程碑...');
const existingMs = db.prepare('SELECT count(*) c FROM project_milestones WHERE project_id = ?').get(projectId).c;
if (existingMs >= 10) {
  console.log(`  里程碑已存在 (${existingMs} 个), 跳过`);
} else {
  const phases = [
    ['S1', '设计冻结', 1], ['S2', '采购', 2], ['S3', '自制件生产', 3], ['S4', '部件预装', 4],
    ['S5', '总装', 5], ['S6', '厂内调试', 6], ['S7', '拆解/包装/发运', 7], ['S8', '现场组装', 8],
    ['S9', '试掘进/验收', 9], ['S10', '质保期', 10],
  ];
  const ins = db.prepare('INSERT INTO project_milestones (project_id, phase_code, phase_name, sequence, planned_start, status) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [code, name, seq] of phases) {
    ins.run(projectId, code, name, seq, '2026-07-01', 'pending');
  }
  console.log(`  ✓ 10 个里程碑已生成`);
}

// ============================================================
// 3) 物料 + 关键外购件
// ============================================================
console.log('\n[3/4] 创建物料主数据 + 关键外购件...');
const matCount = db.prepare('SELECT count(*) c FROM materials').get().c;
if (matCount > 0) {
  console.log(`  物料已存在 (${matCount} 个), 跳过`);
} else {
  // 物料数据（与 seed-bom-epb4000.js 一致）
  const materials = [
    { code: 'M-ST-Q345-20',  name: 'Q345 低合金钢板 δ=20mm', type: 'steel', spec: 'δ=20mm', unit: 'kg', self: 1, key: 0 },
    { code: 'M-ST-Q345-30',  name: 'Q345 低合金钢板 δ=30mm', type: 'steel', spec: 'δ=30mm', unit: 'kg', self: 1, key: 0 },
    { code: 'M-ST-Q345-40',  name: 'Q345 低合金钢板 δ=40mm', type: 'steel', spec: 'δ=40mm', unit: 'kg', self: 1, key: 0 },
    { code: 'M-ST-Q345-50',  name: 'Q345 低合金钢板 δ=50mm', type: 'steel', spec: 'δ=50mm', unit: 'kg', self: 1, key: 0 },
    { code: 'M-ST-16MN-60',  name: '16Mn 合金钢 δ=60mm',     type: 'steel', spec: 'δ=60mm', unit: 'kg', self: 1, key: 0 },
    { code: 'M-WL-E5015',    name: '焊条 E5015',              type: 'welding', spec: 'Φ4mm', unit: 'kg', self: 0, key: 0 },
    { code: 'M-WS-ER50-6',   name: '焊丝 ER50-6',             type: 'welding', spec: 'Φ1.2mm', unit: 'kg', self: 0, key: 0 },
    { code: 'M-BOLT-M20-10', name: '高强度螺栓 M20×100',      type: 'fastener', spec: '10.9级', unit: 'pcs', self: 0, key: 0 },
    { code: 'M-BOLT-M24-12', name: '高强度螺栓 M24×120',      type: 'fastener', spec: '10.9级', unit: 'pcs', self: 0, key: 0 },
    { code: 'M-BOLT-M30-15', name: '高强度螺栓 M30×150',      type: 'fastener', spec: '10.9级', unit: 'pcs', self: 0, key: 0 },
    { code: 'M-BRG-MAIN',    name: '主轴承 (Φ3000 三排滚子)',  type: 'bought_part', spec: 'Φ3000 SKF', unit: 'pcs', self: 0, key: 1, supplier: 'SKF', lead_w: 20, risk: 'high' },
    { code: 'M-REDUCER',     name: '行星减速机',              type: 'bought_part', spec: 'i=20 400kW', unit: 'pcs', self: 0, key: 1, supplier: 'SEW', lead_w: 16, risk: 'high' },
    { code: 'M-MOTOR-DRIVE', name: '变频电机 75kW ×6',        type: 'bought_part', spec: '75kW 4P IP55', unit: 'pcs', self: 0, key: 1, supplier: 'ABB', lead_w: 12, risk: 'medium' },
    { code: 'M-CUTTER-DISC', name: '盘形滚刀 Φ432',          type: 'bought_part', spec: 'Φ432 17寸', unit: 'pcs', self: 0, key: 1, supplier: '罗宾斯', lead_w: 12, risk: 'medium' },
    { code: 'M-CUTTER-SCRAP',name: '刮刀',                    type: 'bought_part', spec: '标准', unit: 'pcs', self: 0, key: 0, supplier: '罗宾斯', lead_w: 8, risk: 'low' },
    { code: 'M-SEAL-MAIN',   name: '主密封 (唇形+挡圈)',      type: 'bought_part', spec: '配套主轴承', unit: 'set', self: 0, key: 1, supplier: 'SKF', lead_w: 14, risk: 'high' },
    { code: 'M-SEAL-ART',    name: '铰接密封',                type: 'bought_part', spec: '配套铰接', unit: 'set', self: 0, key: 1, supplier: '派克', lead_w: 8, risk: 'medium' },
    { code: 'M-SEAL-TAIL',   name: '尾刷密封 (3 道)',         type: 'bought_part', spec: '尾部专用', unit: 'set', self: 0, key: 1, supplier: '派克', lead_w: 8, risk: 'medium' },
    { code: 'M-PUMP-MAIN',   name: '主液压泵',                type: 'bought_part', spec: '280bar 200L/min', unit: 'pcs', self: 0, key: 1, supplier: '博世力士乐', lead_w: 10, risk: 'medium' },
    { code: 'M-CYL-THRUST',  name: '推进油缸',                type: 'bought_part', spec: 'Φ200/140 行程100', unit: 'pcs', self: 0, key: 0, supplier: '博世力士乐', lead_w: 10, risk: 'medium' },
    { code: 'M-CYL-ART',     name: '铰接油缸',                type: 'bought_part', spec: 'Φ160/110 行程80', unit: 'pcs', self: 0, key: 0, supplier: '博世力士乐', lead_w: 10, risk: 'medium' },
    { code: 'M-ERECTOR',     name: '管片拼装机',              type: 'bought_part', spec: '举升力 100kN', unit: 'pcs', self: 0, key: 1, supplier: '海瑞克', lead_w: 18, risk: 'high' },
    { code: 'M-SCREW',       name: '螺旋输送机',              type: 'bought_part', spec: 'Φ600 无轴', unit: 'pcs', self: 0, key: 0, supplier: '海瑞克', lead_w: 14, risk: 'medium' },
    { code: 'M-PLC',         name: '西门子 PLC S7-1500',      type: 'bought_part', spec: 'CPU 1515-2 PN', unit: 'set', self: 0, key: 1, supplier: '西门子', lead_w: 8, risk: 'low' },
    { code: 'M-VFD',         name: 'ABB 变频器 ACS880',       type: 'bought_part', spec: '75kW', unit: 'pcs', self: 0, key: 1, supplier: 'ABB', lead_w: 8, risk: 'low' },
    { code: 'M-SWITCH',      name: '低压配电柜',              type: 'bought_part', spec: 'GGD2 定制', unit: 'pcs', self: 0, key: 0, supplier: '正泰', lead_w: 6, risk: 'low' },
    { code: 'M-MANIFOLD',    name: '液压阀组',                type: 'bought_part', spec: '定制', unit: 'pcs', self: 1, key: 0, supplier: '自制+外购', lead_w: 8, risk: 'low' },
    { code: 'M-OIL-TANK',    name: '液压油箱 1000L',          type: 'bought_part', spec: '不锈钢 1000L', unit: 'pcs', self: 1, key: 0, supplier: '自制+外购', lead_w: 4, risk: 'low' },
    { code: 'M-PIPE',        name: '高压油管 + 接头',         type: 'bought_part', spec: '配套', unit: 'm', self: 0, key: 0, supplier: '伊顿', lead_w: 4, risk: 'low' },
    { code: 'M-CABLE',       name: '动力/控制电缆',           type: 'bought_part', spec: 'YJV22 0.6/1kV', unit: 'm', self: 0, key: 0, supplier: '远东', lead_w: 4, risk: 'low' },
    { code: 'M-TRAILER',     name: '拖车底盘 + 结构',         type: 'bought_part', spec: '自制定制', unit: 'set', self: 1, key: 0, supplier: '自制', lead_w: 0, risk: 'low' },
    { code: 'M-CAB',         name: '操作室',                  type: 'bought_part', spec: '隔音 + 空调', unit: 'pcs', self: 1, key: 0, supplier: '自制', lead_w: 4, risk: 'low' },
    { code: 'M-VENT',        name: '通风机',                  type: 'bought_part', spec: '2×37kW', unit: 'set', self: 0, key: 0, supplier: '沈鼓', lead_w: 6, risk: 'low' },
    { code: 'M-DOOR-MAN',    name: '人舱门 (Φ600)',           type: 'bought_part', spec: '气密', unit: 'pcs', self: 1, key: 0, supplier: '自制', lead_w: 4, risk: 'low' },
  ];

  const ins = db.prepare(`INSERT INTO materials (material_code, material_name, material_type, spec, unit, is_key_component, is_self_made, default_supplier) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insKC = db.prepare(`INSERT INTO key_components (material_id, component_type, supplier, supplier_part_no, lead_time_weeks, risk_level) VALUES (?, ?, ?, ?, ?, ?)`);
  const matId = {};
  let kc = 0;

  for (const m of materials) {
    const r = ins.run(m.code, m.name, m.type, m.spec, m.unit, m.key, m.self, m.supplier || null);
    matId[m.code] = r.lastInsertRowid;
    if (m.key && m.lead_w !== undefined) {
      const ctype = m.code.includes('BRG') ? 'main_bearing' :
                    m.code.includes('REDUCER') ? 'reducer' :
                    m.code.includes('MOTOR') ? 'drive_motor' :
                    m.code.includes('CUTTER-DISC') ? 'cutter' :
                    m.code.includes('SEAL') ? 'seal' :
                    m.code.includes('PUMP') ? 'hydraulic_pump' :
                    m.code.includes('ERECTOR') ? 'erector' :
                    m.code.includes('PLC') ? 'plc' :
                    m.code.includes('VFD') ? 'inverter' : 'other';
      insKC.run(matId[m.code], ctype, m.supplier, m.code, m.lead_w, m.risk);
      kc++;
    }
  }
  console.log(`  ✓ ${materials.length} 物料 + ${kc} 关键外购件已录入`);
}

// ============================================================
// 4) BOM 树
// ============================================================
console.log('\n[4/4] 创建 9 大子系统 BOM 树 (5 级)...');
const bomCount = db.prepare('SELECT count(*) c FROM project_bom WHERE project_id = ?').get(projectId).c;
if (bomCount > 0) {
  console.log(`  BOM 已存在 (${bomCount} 节点), 跳过`);
} else {
  const insBom = db.prepare(`INSERT INTO project_bom (project_id, parent_id, material_id, level, quantity, is_key_component, is_alternative, alternative_group, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const bomId = {};
  function addBOM(name, level, parentName, matCode, qty, isKey = 0) {
    const parentId = parentName ? bomId[parentName] : null;
    const mId = matCode ? db.prepare('SELECT id FROM materials WHERE material_code = ?').get(matCode)?.id : null;
    const r = insBom.run(projectId, parentId, mId, level, qty, isKey, 0, null, null);
    bomId[name] = r.lastInsertRowid;
  }

  // L1 整机
  addBOM('整机', 1, null, null, 1);
  // L2 9 子系统
  addBOM('刀盘', 2, '整机', null, 1);
  addBOM('主驱动', 2, '整机', null, 1);
  addBOM('盾体', 2, '整机', null, 1);
  addBOM('推进系统', 2, '整机', null, 1);
  addBOM('拼装系统', 2, '整机', null, 1);
  addBOM('出渣系统', 2, '整机', null, 1);
  addBOM('液压系统', 2, '整机', null, 1);
  addBOM('电气控制', 2, '整机', null, 1);
  addBOM('后配套', 2, '整机', null, 1);
  // 刀盘
  addBOM('刀盘体', 3, '刀盘', null, 1);
  addBOM('面板', 4, '刀盘体', 'M-ST-Q345-40', 3500);
  addBOM('法兰', 4, '刀盘体', 'M-ST-Q345-50', 800);
  addBOM('刀具安装座', 4, '刀盘体', 'M-ST-16MN-60', 600);
  addBOM('盘形滚刀', 5, '刀具安装座', 'M-CUTTER-DISC', 12, 1);
  addBOM('刮刀', 5, '刀具安装座', 'M-CUTTER-SCRAP', 8);
  addBOM('中心刀', 5, '刀具安装座', 'M-CUTTER-DISC', 1, 1);
  // 主驱动
  addBOM('主轴承座', 3, '主驱动', 'M-ST-Q345-50', 1200);
  addBOM('主轴承', 3, '主驱动', 'M-BRG-MAIN', 1, 1);
  addBOM('减速机', 3, '主驱动', 'M-REDUCER', 3, 1);
  addBOM('驱动电机', 3, '主驱动', 'M-MOTOR-DRIVE', 6, 1);
  addBOM('主密封', 3, '主驱动', 'M-SEAL-MAIN', 1, 1);
  // 盾体
  addBOM('前盾', 3, '盾体', null, 1);
  addBOM('前盾外壳', 4, '前盾', 'M-ST-Q345-40', 5800);
  addBOM('前盾隔板', 4, '前盾', 'M-ST-Q345-30', 1200);
  addBOM('中盾', 3, '盾体', null, 1);
  addBOM('中盾外壳', 4, '中盾', 'M-ST-Q345-40', 4600);
  addBOM('中盾隔板', 4, '中盾', 'M-ST-Q345-30', 900);
  addBOM('尾盾', 3, '盾体', null, 1);
  addBOM('尾盾外壳', 4, '尾盾', 'M-ST-Q345-40', 3200);
  addBOM('尾刷密封', 4, '尾盾', 'M-SEAL-TAIL', 1, 1);
  addBOM('铰接油缸', 3, '盾体', 'M-CYL-ART', 14);
  addBOM('铰接密封', 3, '盾体', 'M-SEAL-ART', 2, 1);
  addBOM('人舱', 3, '盾体', null, 1);
  addBOM('人舱门', 4, '人舱', 'M-DOOR-MAN', 1);
  // 推进
  addBOM('推进油缸', 3, '推进系统', 'M-CYL-THRUST', 16);
  addBOM('支撑环', 3, '推进系统', 'M-ST-Q345-50', 2200);
  addBOM('管片支撑', 3, '推进系统', null, 1);
  addBOM('管片支撑靴', 4, '管片支撑', 'M-ST-Q345-30', 320);
  // 拼装
  addBOM('拼装机本体', 3, '拼装系统', 'M-ERECTOR', 1, 1);
  addBOM('回转机构', 4, '拼装机本体', null, 1);
  addBOM('真空吸盘', 4, '拼装机本体', null, 2);
  // 出渣
  addBOM('螺旋输送机', 3, '出渣系统', 'M-SCREW', 1);
  addBOM('皮带机', 3, '出渣系统', null, 1);
  addBOM('渣土改良注入', 3, '出渣系统', null, 1);
  // 液压
  addBOM('主泵站', 3, '液压系统', null, 1);
  addBOM('主液压泵', 4, '主泵站', 'M-PUMP-MAIN', 4, 1);
  addBOM('油箱', 4, '主泵站', 'M-OIL-TANK', 1);
  addBOM('阀组', 4, '主泵站', 'M-MANIFOLD', 3);
  addBOM('推进液压回路', 3, '液压系统', null, 1);
  addBOM('铰接液压回路', 3, '液压系统', null, 1);
  addBOM('拼装液压回路', 3, '液压系统', null, 1);
  addBOM('高压油管+接头', 3, '液压系统', 'M-PIPE', 200);
  // 电气
  addBOM('PLC 控制系统', 3, '电气控制', 'M-PLC', 1, 1);
  addBOM('低压配电柜', 3, '电气控制', 'M-SWITCH', 3);
  addBOM('操作台', 3, '电气控制', null, 1);
  addBOM('变频柜', 3, '电气控制', 'M-VFD', 6, 1);
  addBOM('监控', 3, '电气控制', null, 1);
  addBOM('通信', 3, '电气控制', null, 1);
  addBOM('动力电缆', 3, '电气控制', 'M-CABLE', 800);
  addBOM('控制电缆', 3, '电气控制', 'M-CABLE', 1500);
  // 后配套
  addBOM('1# 拖车 (电气)', 3, '后配套', 'M-TRAILER', 1);
  addBOM('2# 拖车 (出渣)', 3, '后配套', 'M-TRAILER', 1);
  addBOM('3# 拖车 (人员)', 3, '后配套', 'M-TRAILER', 1);
  addBOM('操作室', 3, '后配套', 'M-CAB', 1);
  addBOM('通风机', 3, '后配套', 'M-VENT', 1);
  addBOM('连接桥', 3, '后配套', null, 2);

  const total = Object.keys(bomId).length;
  console.log(`  ✓ ${total} 个 BOM 节点已创建 (5 级)`);
}

// ============================================================
// 完成
// ============================================================
console.log('\n=== ✅ 演示数据已就绪 ===\n');
const stats = {
  projects: db.prepare('SELECT count(*) c FROM projects').get().c,
  milestones: db.prepare('SELECT count(*) c FROM project_milestones').get().c,
  materials: db.prepare('SELECT count(*) c FROM materials').get().c,
  bom_nodes: db.prepare('SELECT count(*) c FROM project_bom').get().c,
  key_components: db.prepare('SELECT count(*) c FROM key_components').get().c,
  long_leadtime: db.prepare('SELECT count(*) c FROM key_components WHERE lead_time_weeks >= 12').get().c,
};
console.log('统计:');
Object.entries(stats).forEach(([k, v]) => console.log(`  ${k.padEnd(20)} ${v}`));
console.log('\n访问: curl http://192.168.1.73:3890/api/projects/1/dashboard');
