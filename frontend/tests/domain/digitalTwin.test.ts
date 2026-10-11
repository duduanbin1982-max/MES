// frontend/tests/domain/digitalTwin.test.ts
//
// DigitalTwin 抽出的 domain 逻辑的无浏览器回归（node:test + Node 22 原生 TS 类型擦除）。
//
//   cd frontend && npm run test:domain
//
// 这些断言覆盖三块：
//   1) buildTBMModel 的结构（部件名、userData、数量、位置）—— 抽出去之后它不再
//      依赖 Vue 组件状态，因此可以真的构造一遍并检查；
//   2) explodeOffsetFor 的偏移量推导（含 gantry_i 的解析）；
//   3) viewModel 的归一化/查找/配色。

import test from "node:test"
import assert from "node:assert/strict"
import * as THREE from "three"

import { buildTBMModel, explodeOffsetFor, gantryBaseZ, PART_EXPLODE_BASE } from "../../src/domain/digitalTwin/tbmModel.ts"
import { metricColor, partLookupKey, pickFirstModel, resolveInstanceById } from "../../src/domain/digitalTwin/viewModel.ts"

test("DT.1 buildTBMModel 组装出预期的部件与数量", () => {
  const meshes = new Map<string, THREE.Mesh>()
  const group = buildTBMModel(meshes)

  assert.equal(group.name, "TBM")
  // 6 个命名部件 + 3 节后配套拖车
  assert.deepEqual(
    [...meshes.keys()].sort(),
    ["cutterhead", "erector", "gantry_0", "gantry_1", "gantry_2", "main_drive", "screw", "shield"].sort()
  )
  assert.equal(meshes.size, 8)
  // partMeshes 里存的必须就是场景里的那几个 mesh
  for (const [name, mesh] of meshes) {
    assert.equal(mesh.name, name)
    assert.ok(group.getObjectByName(name), `${name} 应在场景树里`)
  }
})

test("DT.2 每个部件的 userData 都带 part_name / assembly_step / color", () => {
  const meshes = new Map<string, THREE.Mesh>()
  buildTBMModel(meshes)
  const named = [...meshes.entries()].filter(([name]) => !name.startsWith("gantry"))
  const expected: Record<string, [string, number, string]> = {
    cutterhead: ["刀盘", 1, "#cc3333"],
    main_drive: ["主驱动", 2, "#3366cc"],
    shield: ["盾体", 3, "#888888"],
    screw: ["螺旋输送机", 4, "#ff9933"],
    erector: ["管片拼装机", 5, "#33aa55"],
  }
  for (const [name] of named) {
    const data = meshes.get(name)!.userData
    assert.equal(data.part_name, expected[name][0], `${name}.part_name`)
    assert.equal(data.assembly_step, expected[name][1], `${name}.assembly_step`)
    assert.equal(data.color, expected[name][2], `${name}.color`)
  }
  // 拖车：assembly_step 从 6 递增
  assert.equal(meshes.get("gantry_0")!.userData.assembly_step, 6)
  assert.equal(meshes.get("gantry_2")!.userData.assembly_step, 8)
  assert.equal(meshes.get("gantry_1")!.userData.part_name, "后配套拖车 2")
})

test("DT.3 关键部件的坐标与刀盘齿/管片环数量", () => {
  const meshes = new Map<string, THREE.Mesh>()
  const group = buildTBMModel(meshes)
  assert.deepEqual(meshes.get("cutterhead")!.position.toArray(), [0, 0, 4])
  assert.deepEqual(meshes.get("main_drive")!.position.toArray(), [0, 0, 2.7])
  assert.deepEqual(meshes.get("shield")!.position.toArray(), [0, 0, -2])
  assert.deepEqual(meshes.get("erector")!.position.toArray(), [0, 0, -5])
  assert.equal(meshes.get("screw")!.rotation.x, Math.PI / 6)
  assert.deepEqual(meshes.get("gantry_1")!.position.toArray(), [0, -0.5, -13.5])

  // 刀盘下挂 24 颗齿
  assert.equal(meshes.get("cutterhead")!.children.length, 24)
  // 场景里非命名件：8 段管片 + 地面
  const unnamed = group.children.filter((child) => !child.name || child.name === "")
  assert.ok(unnamed.length >= 9, `未命名件应含 8 段管片 + 地面, 实际 ${unnamed.length}`)
})

test("DT.4 explodeOffsetFor 与原来的硬编码分支完全等价", () => {
  // factor = 1 时应等于原始基准值
  assert.deepEqual(explodeOffsetFor("cutterhead", 1), { axis: "z", value: 4 })
  assert.deepEqual(explodeOffsetFor("main_drive", 1), { axis: "z", value: 2.7 })
  assert.deepEqual(explodeOffsetFor("screw", 1), { axis: "y", value: -0.8 })
  assert.deepEqual(explodeOffsetFor("erector", 1), { axis: "z", value: -5 })
  // 展开 2.5 倍
  assert.deepEqual(explodeOffsetFor("cutterhead", 2.5), { axis: "z", value: 10 })
  assert.deepEqual(explodeOffsetFor("screw", 2.5), { axis: "y", value: -2 })
  // gantry_i：-9 - i*4.5
  assert.deepEqual(explodeOffsetFor("gantry_0", 1), { axis: "z", value: -9 })
  assert.deepEqual(explodeOffsetFor("gantry_2", 1), { axis: "z", value: -18 })
  assert.deepEqual(explodeOffsetFor("gantry_1", 2.5), { axis: "z", value: -33.75 })
  assert.equal(gantryBaseZ(3), -22.5)
  // 不参与的部件返回 null
  assert.equal(explodeOffsetFor("shield", 2.5), null)
  assert.equal(explodeOffsetFor("unknown", 1), null)
  // 名字畸形时不能抛
  assert.equal(explodeOffsetFor("gantry_x", 1), null)
  assert.equal(Object.keys(PART_EXPLODE_BASE).length, 4)
})

test("DT.5 metricColor 的阈值与顺序不变", () => {
  assert.equal(metricColor(null), "var(--el-color-white)")
  assert.equal(metricColor({}), "var(--el-color-primary)")
  // 温度：>80 danger, >60 warning, 其余 success
  assert.equal(metricColor({ metric_name: "temp_in", metric_value: 81 }), "var(--el-color-danger)")
  assert.equal(metricColor({ metric_name: "temp_in", metric_value: 80 }), "var(--el-color-warning)")
  assert.equal(metricColor({ metric_name: "temp_in", metric_value: 61 }), "var(--el-color-warning)")
  assert.equal(metricColor({ metric_name: "temp_in", metric_value: 60 }), "var(--el-color-success)")
  // 振动：>7 danger
  assert.equal(metricColor({ metric_name: "vibration", metric_value: 8 }), "var(--el-color-danger)")
  assert.equal(metricColor({ metric_name: "vibration", metric_value: 7 }), "var(--el-color-success)")
  // temp 优先于 vibration（与原始 if 顺序一致）
  assert.equal(metricColor({ metric_name: "temp_vibration", metric_value: 100 }), "var(--el-color-danger)")
  // 缺 metric_value 时按 0 处理
  assert.equal(metricColor({ metric_name: "temp" }), "var(--el-color-success)")
})

test("DT.6 pickFirstModel / resolveInstanceById / partLookupKey 的归一化", () => {
  assert.deepEqual(pickFirstModel({ items: [{ id: 1 }, { id: 2 }] }), { id: 1 })
  assert.deepEqual(pickFirstModel([{ id: 9 }]), { id: 9 })
  assert.equal(pickFirstModel({ items: [] }), undefined)
  assert.equal(pickFirstModel(null), undefined)

  const list = [{ id: 1 }, { id: 2 }]
  assert.deepEqual(resolveInstanceById(list, 2), { id: 2 })
  assert.equal(resolveInstanceById(list, 3), null)
  assert.equal(resolveInstanceById(null, 1), null)
  assert.equal(resolveInstanceById(undefined, 1), null)

  assert.equal(partLookupKey({ mesh_name: "m", part_name: "p" }), "m")
  assert.equal(partLookupKey({ part_name: "p" }), "p")
  assert.equal(partLookupKey({}), null)
  assert.equal(partLookupKey(null), null)
})
