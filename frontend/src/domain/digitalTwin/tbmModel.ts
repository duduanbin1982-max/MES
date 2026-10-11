// frontend/src/domain/digitalTwin/tbmModel.ts
//
// 程序化 TBM 模型（Three.js）：真实 GLB 未就绪时用的参考模型。
// 2026-10-11 从 frontend/src/views/DigitalTwin.vue 抽出（原为该文件内的闭包函数）。
//
// 抽出的理由：这一段是纯几何构建，唯一的闭包依赖 partMeshes 已改成入参，
// 因此可以直接用 node:test 断言结构（部件名 / userData / 数量 / 位置）。
//
// 本文件属于 frontend/src/domain 层：按 scripts/check-layer-boundaries.js 的约束，
// 不允许 import vue / element-plus / api / components。

import * as THREE from "three"

// ===== Procedural TBM Model =====
export function buildTBMModel(partMeshes: Map<string, THREE.Mesh>) {
  const group = new THREE.Group()
  group.name = "TBM"

  const materials = {
    cutterhead: new THREE.MeshPhongMaterial({ color: 0xcc3333, specular: 0x222222, shininess: 30 }),
    mainDrive: new THREE.MeshPhongMaterial({ color: 0x3366cc, specular: 0x222222, shininess: 30 }),
    shield: new THREE.MeshPhongMaterial({ color: 0x888888, specular: 0x333333, shininess: 50 }),
    screw: new THREE.MeshPhongMaterial({ color: 0xff9933, specular: 0x111111, shininess: 20 }),
    erector: new THREE.MeshPhongMaterial({ color: 0x33aa55, specular: 0x222222, shininess: 30 }),
    gantry: new THREE.MeshPhongMaterial({ color: 0x666699, specular: 0x222222, shininess: 20 }),
    segment: new THREE.MeshPhongMaterial({ color: 0xaaaaaa, specular: 0x111111, shininess: 10 }),
  }

  // Cutterhead (front disk)
  const cutterGeo = new THREE.CylinderGeometry(2.1, 2.1, 0.5, 48)
  const cutter = new THREE.Mesh(cutterGeo, materials.cutterhead)
  cutter.position.set(0, 0, 4)
  cutter.name = "cutterhead"
  cutter.userData = { part_name: "刀盘", assembly_step: 1, color: "#cc3333" }
  group.add(cutter)
  partMeshes.set("cutterhead", cutter)

  // Cutter teeth
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2
    const toothGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.4, 8)
    const tooth = new THREE.Mesh(toothGeo, new THREE.MeshPhongMaterial({ color: 0xffdd00 }))
    tooth.position.set(Math.cos(angle) * 2.0, Math.sin(angle) * 2.0, 4.3)
    cutter.add(tooth)
  }

  // Main Drive
  const driveGeo = new THREE.CylinderGeometry(1.6, 1.8, 2.5, 32)
  const drive = new THREE.Mesh(driveGeo, materials.mainDrive)
  drive.position.set(0, 0, 2.7)
  drive.name = "main_drive"
  drive.userData = { part_name: "主驱动", assembly_step: 2, color: "#3366cc" }
  group.add(drive)
  partMeshes.set("main_drive", drive)

  // Shield body (front)
  const shieldGeo = new THREE.CylinderGeometry(2.0, 2.1, 8, 32)
  const shield = new THREE.Mesh(shieldGeo, materials.shield)
  shield.position.set(0, 0, -2)
  shield.name = "shield"
  shield.userData = { part_name: "盾体", assembly_step: 3, color: "#888888" }
  group.add(shield)
  partMeshes.set("shield", shield)

  // Screw Conveyor
  const screwGeo = new THREE.CylinderGeometry(0.4, 0.5, 6, 16)
  const screw = new THREE.Mesh(screwGeo, materials.screw)
  screw.rotation.x = Math.PI / 6
  screw.position.set(0, -0.8, -3)
  screw.name = "screw"
  screw.userData = { part_name: "螺旋输送机", assembly_step: 4, color: "#ff9933" }
  group.add(screw)
  partMeshes.set("screw", screw)

  // Segment Erector
  const erectorGeo = new THREE.TorusGeometry(1.8, 0.2, 16, 32)
  const erector = new THREE.Mesh(erectorGeo, materials.erector)
  erector.position.set(0, 0, -5)
  erector.name = "erector"
  erector.userData = { part_name: "管片拼装机", assembly_step: 5, color: "#33aa55" }
  group.add(erector)
  partMeshes.set("erector", erector)

  // Segments ring
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    const segGeo = new THREE.BoxGeometry(0.5, 0.3, 1.2)
    const seg = new THREE.Mesh(segGeo, materials.segment)
    seg.position.set(Math.cos(angle) * 1.8, Math.sin(angle) * 1.8, -5)
    seg.rotation.z = angle
    group.add(seg)
  }

  // Gantry (trailing cars) - simplified
  for (let i = 0; i < 3; i++) {
    const gantryGeo = new THREE.BoxGeometry(3.5, 2.5, 4)
    const gantry = new THREE.Mesh(gantryGeo, materials.gantry)
    gantry.position.set(0, -0.5, -9 - i * 4.5)
    gantry.name = `gantry_${i}`
    gantry.userData = { part_name: `后配套拖车 ${i+1}`, assembly_step: 6 + i, color: "#666699" }
    group.add(gantry)
    partMeshes.set(`gantry_${i}`, gantry)
  }

  // Ground plane
  const groundGeo = new THREE.PlaneGeometry(20, 30)
  const groundMat = new THREE.MeshPhongMaterial({ color: 0x333333, side: THREE.DoubleSide })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.set(0, -3.5, -5)
  group.add(ground)

  return group
}

/** 爆炸视图的基准偏移量（factor = 1 时部件的坐标） */
export const PART_EXPLODE_BASE: Record<string, { axis: "y" | "z"; value: number }> = {
  cutterhead: { axis: "z", value: 4 },
  main_drive: { axis: "z", value: 2.7 },
  screw: { axis: "y", value: -0.8 },
  erector: { axis: "z", value: -5 },
}

/** gantry_i 的基准 z：-9 - i * 4.5 */
export function gantryBaseZ(index: number): number {
  return -9 - index * 4.5
}

/**
 * 某个部件在爆炸视图下应处的坐标。
 * 返回 null 表示该部件不参与爆炸（位置不动）。
 */
export function explodeOffsetFor(name: string, factor: number): { axis: "y" | "z"; value: number } | null {
  const base = PART_EXPLODE_BASE[name]
  if (base) return { axis: base.axis, value: base.value * factor }
  if (name.startsWith("gantry")) {
    const index = parseInt(name.split("_")[1], 10)
    if (!Number.isFinite(index)) return null
    return { axis: "z", value: gantryBaseZ(index) * factor }
  }
  return null
}
