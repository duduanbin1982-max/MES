<template>
  <div class="dt-page">
    <!-- 3D Canvas -->
    <div ref="containerRef" class="dt-canvas"></div>

    <!-- Overlay Panel -->
    <div class="dt-overlay">
      <div class="dt-title"><el-icon><Promotion /></el-icon> 数字孪生 · {{ selectedInstance?.instance_name || 'TBM 盾构机' }}</div>
      <el-select v-model="selectedId" placeholder="选择装备" style="width:260px" @change="onInstanceChange" size="small">
        <el-option v-for="inst in instances" :key="inst.id" :label="inst.instance_name" :value="inst.id" />
      </el-select>
      <el-tag :type="currentModel?.asset_ready?'success':'warning'">{{ currentModel?.asset_ready?'真实 GLB':'参考模型' }}</el-tag>
      <el-button v-if="currentModel && !currentModel.asset_ready" size="small" type="primary" @click="fileInput?.click()">上传 GLB</el-button>
      <input ref="fileInput" type="file" accept=".glb,model/gltf-binary" hidden @change="uploadModel" />
    </div>

    <!-- Info Panel -->
    <div class="dt-info-panel" v-if="hoveredPart">
      <div class="dt-info-title">{{ hoveredPart.part_name }}</div>
      <div class="dt-info-row">装配步骤: {{ hoveredPart.assembly_step || '-' }}</div>
      <div class="dt-info-row" v-if="hoveredPart.metric">
        {{ hoveredPart.metric.metric_name }}: <b :style="{color: metricColor(hoveredPart.metric)}">{{ hoveredPart.metric.metric_value }}{{ hoveredPart.metric.metric_unit }}</b>
      </div>
    </div>

    <!-- Legend -->
    <div class="dt-legend">
      <div class="dt-legend-title">部件图例</div>
      <div v-for="p in parts" :key="p.id" class="dt-legend-item" role="button" tabindex="0" @click="focusPart(p)" @keydown.enter.prevent="focusPart(p)" @keydown.space.prevent="focusPart(p)" :style="{borderLeftColor: p.color_hex}">
        <span :style="{color: p.color_hex}">●</span> {{ p.part_name }}
      </div>
    </div>

    <!-- Controls -->
    <div class="dt-controls">
      <el-button-group size="small">
        <el-button @click="resetCamera">重置视角</el-button>
        <el-button @click="toggleWireframe">{{ wireframe ? '实体' : '线框' }}</el-button>
        <el-button @click="toggleExplode">{{ explode ? '合并' : '分解' }}</el-button>
      </el-button-group>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, nextTick, watch } from "vue"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js"
import Api from "../api"
import { ElMessage } from "element-plus"

const containerRef = ref<HTMLElement>()
const selectedId = ref(1)
const hoveredPart = ref<any>(null)
const wireframe = ref(false)
const explode = ref(false)
const instances = ref<any[]>([])
const selectedInstance = ref<any>(null)
const parts = ref<any[]>([])
const currentModel = ref<any>(null)
const fileInput = ref<HTMLInputElement>()

// Three.js objects
let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, controls: OrbitControls
let partMeshes: Map<string, THREE.Mesh> = new Map()
let raycaster: THREE.Raycaster, mouse: THREE.Vector2
let animationId: number

// ===== Procedural TBM Model =====
function buildTBMModel() {
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

// ===== Scene Setup =====
function initScene() {
  if (!containerRef.value) return

  // Scene
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a2e)
  scene.fog = new THREE.Fog(0x1a1a2e, 15, 40)

  // Camera
  camera = new THREE.PerspectiveCamera(50, containerRef.value.clientWidth / containerRef.value.clientHeight, 0.5, 100)
  camera.position.set(12, 6, 12)
  camera.lookAt(0, 0, -2)

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(containerRef.value.clientWidth, containerRef.value.clientHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  containerRef.value.appendChild(renderer.domElement)

  // Controls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 0, -2)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 5
  controls.maxDistance = 25
  controls.maxPolarAngle = Math.PI * 0.7

  // Lighting
  const ambient = new THREE.AmbientLight(0x404060, 1.5)
  scene.add(ambient)
  const dir1 = new THREE.DirectionalLight(0xffffff, 2)
  dir1.position.set(10, 15, 10)
  dir1.castShadow = true
  scene.add(dir1)
  const dir2 = new THREE.DirectionalLight(0x4488cc, 1)
  dir2.position.set(-5, 3, -5)
  scene.add(dir2)

  // Grid helper
  const grid = new THREE.GridHelper(20, 20, 0x444466, 0x222244)
  grid.position.y = -3.5
  scene.add(grid)

  renderSelectedModel()

  // Raycaster for hover
  raycaster = new THREE.Raycaster()
  mouse = new THREE.Vector2()

  // Events
  window.addEventListener("resize", onResize)
  renderer.domElement.addEventListener("mousemove", onMouseMove)

  animate()
}

function clearModel() {
  const current = scene?.getObjectByName("tbm_group")
  if (current) {
    current.traverse((child: any) => {
      if (child.geometry) child.geometry.dispose()
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m: any) => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    })
    scene.remove(current)
  }
  partMeshes.clear()
}

function frameObject(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const distance = Math.max(size.x, size.y, size.z) * 1.8 || 10
  controls.target.copy(center)
  camera.position.copy(center.clone().add(new THREE.Vector3(distance, distance * 0.5, distance)))
  controls.update()
}

function renderSelectedModel() {
  if (!scene) return
  clearModel()
  if (currentModel.value?.asset_ready && currentModel.value.file_path) {
    new GLTFLoader().load('/' + currentModel.value.file_path, (gltf: GLTF) => {
      const model = gltf.scene
      model.name = "tbm_group"
      const scale = Number(currentModel.value.scale_factor || 1)
      model.scale.setScalar(scale)
      model.traverse((child:any) => {
        if (child.isMesh) {
          child.castShadow = true
          child.receiveShadow = true
          partMeshes.set(child.name, child)
        }
      })
      scene.add(model)
      frameObject(model)
    }, undefined, () => ElMessage.error('GLB 加载失败，请检查文件'))
    return
  }
  const reference = buildTBMModel()
  reference.name = "tbm_group"
  scene.add(reference)
}

function onResize() {
  if (!containerRef.value) return
  camera.aspect = containerRef.value.clientWidth / containerRef.value.clientHeight
  camera.updateProjectionMatrix()
  renderer.setSize(containerRef.value.clientWidth, containerRef.value.clientHeight)
}

function onMouseMove(e: MouseEvent) {
  if (!containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const meshes = Array.from(partMeshes.values())
  const intersects = raycaster.intersectObjects(meshes, true)

  // Reset all emissive
  meshes.forEach(m => {
    const mat = (m as THREE.Mesh).material as THREE.MeshPhongMaterial
    mat.emissive?.set(0x000000)
  })

  if (intersects.length > 0) {
    let obj = intersects[0].object as THREE.Mesh
    while (obj && !obj.userData?.part_name) obj = obj.parent as THREE.Mesh
    if (obj?.userData?.part_name) {
      const mat = obj.material as THREE.MeshPhongMaterial
      mat.emissive?.set(0x333333)
      hoveredPart.value = {
        part_name: obj.userData.part_name,
        assembly_step: obj.userData.assembly_step,
        color: obj.userData.color,
      }
      containerRef.value.style.cursor = "pointer"
      return
    }
  }
  hoveredPart.value = null
  if (containerRef.value) containerRef.value.style.cursor = "grab"
}

function animate() {
  animationId = requestAnimationFrame(animate)
  controls.update()

  // Subtle screw rotation
  const screw = partMeshes.get("screw")
  if (screw) screw.rotation.z += 0.01

  renderer.render(scene, camera)
}

function resetCamera() {
  camera.position.set(12, 6, 12)
  controls.target.set(0, 0, -2)
  controls.update()
}

function toggleWireframe() {
  wireframe.value = !wireframe.value
  partMeshes.forEach(m => {
    const mat = m.material as THREE.MeshPhongMaterial
    mat.wireframe = wireframe.value
  })
}

function toggleExplode() {
  explode.value = !explode.value
  const factor = explode.value ? 2.5 : 1
  partMeshes.forEach((m, name) => {
    if (name === "cutterhead") m.position.z = 4 * factor
    else if (name === "main_drive") m.position.z = 2.7 * factor
    else if (name === "screw") m.position.y = -0.8 * factor
    else if (name === "erector") m.position.z = -5 * factor
    else if (name.startsWith("gantry")) {
      const idx = parseInt(name.split("_")[1])
      m.position.z = (-9 - idx * 4.5) * factor
    }
  })
}

function focusPart(part: any) {
  const mesh = partMeshes.get(part.mesh_name || part.part_name)
  if (!mesh) return
  const pos = new THREE.Vector3()
  mesh.getWorldPosition(pos)
  controls.target.copy(pos)
  camera.position.copy(pos.clone().add(new THREE.Vector3(5, 3, 5)))
  controls.update()
}

function metricColor(m: any) {
  if (!m) return "var(--el-color-white)"
  const v = m.metric_value
  if (m.metric_name?.includes("temp")) return v > 80 ? "var(--el-color-danger)" : v > 60 ? "var(--el-color-warning)" : "var(--el-color-success)"
  if (m.metric_name?.includes("vibration")) return v > 7 ? "var(--el-color-danger)" : "var(--el-color-success)"
  return "var(--el-color-primary)"
}

async function onInstanceChange() {
  const inst = instances.value.find(i => i.id === selectedId.value)
  selectedInstance.value = inst
  await loadTwinData()
}

async function loadTwinData() {
  const modelRows = await Api.get("/dt/models", { params: { instance_id: selectedId.value } })
  const model = (modelRows.items || modelRows || [])[0]
  if (!model) {
    parts.value = []
    currentModel.value = null
    renderSelectedModel()
    return
  }
  const sceneData = await Api.get("/dt/scene/" + model.id)
  currentModel.value = sceneData.model
  parts.value = sceneData.parts || []
  renderSelectedModel()
}

async function uploadModel(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !currentModel.value) return
  const token = localStorage.getItem('token') || ''
  const response = await fetch(`/api/dt/models/${currentModel.value.id}/file`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    return ElMessage.error(error.message || 'GLB 上传失败')
  }
  ElMessage.success('真实 GLB 已上传并激活')
  await loadTwinData()
  ;(event.target as HTMLInputElement).value = ''
}

async function loadData() {
  try {
    const instanceRows = await Api.instances()
    instances.value = instanceRows.items || instanceRows || []
    if (instances.value.length > 0) {
      selectedId.value = instances.value[0].id
      selectedInstance.value = instances.value[0]
      await loadTwinData()
    }
  } catch (_) {
    instances.value = []
    parts.value = []
  }
}

onMounted(async () => {
  await loadData()
  await nextTick()
  initScene()
})

onBeforeUnmount(() => {
  window.removeEventListener("resize", onResize)
  if (renderer?.domElement) renderer.domElement.removeEventListener("mousemove", onMouseMove)
  cancelAnimationFrame(animationId)
  renderer?.dispose()
})
</script>

<style scoped>
.dt-page { position: relative; width: 100%; height: calc(100vh - 60px); overflow: hidden; background: #1a1a2e; }
.dt-canvas { width: 100%; height: 100%; }
.dt-overlay { position: absolute; top: 16px; left: 16px; display: flex; align-items: center; gap: 12px; z-index: 10; }
.dt-title { color: var(--el-color-white); font-size: 18px; font-weight: 700; text-shadow: 0 2px 8px rgba(0,0,0,0.5); }
.dt-info-panel { position: absolute; top: 80px; right: 16px; background: rgba(20,20,40,0.9); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 12px 16px; color: var(--el-color-white); z-index: 10; min-width: 180px; backdrop-filter: blur(8px); }
.dt-info-title { font-size: 15px; font-weight: 700; margin-bottom: 6px; }
.dt-info-row { font-size: 13px; color: #ccc; margin: 2px 0; }
.dt-legend { position: absolute; bottom: 80px; left: 16px; background: rgba(20,20,40,0.9); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 10px 14px; color: var(--el-color-white); z-index: 10; backdrop-filter: blur(8px); }
.dt-legend-title { font-size: 13px; font-weight: 700; margin-bottom: 6px; color: #aaa; }
.dt-legend-item { font-size: 12px; padding: 2px 0; cursor: pointer; border-left: 2px solid; padding-left: 8px; margin: 2px 0; color: #ccc; }
.dt-legend-item:hover { color: var(--el-color-white); }
.dt-controls { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 10; }
</style>
