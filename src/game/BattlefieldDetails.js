import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export function enhanceTank(group, environment, enemy = false) {
  const armor = environment.armor(enemy ? 0x77714a : 0x778046)
  const darkArmor = environment.armor(enemy ? 0x53513b : 0x505b32)
  const metal = new THREE.MeshStandardMaterial({ color: 0x3c3a30, metalness: 0.65, roughness: 0.55 })
  const wood = new THREE.MeshStandardMaterial({ color: 0x936537, roughness: 0.9, map: environment.texture('bark-color', true, 1, 2) })
  const ring = new THREE.Shape()
  ring.moveTo(-2.8, -0.75); ring.lineTo(2.8, -0.75)
  ring.quadraticCurveTo(4.0, 0, 2.8, 0.75); ring.lineTo(-2.8, 0.75)
  ring.quadraticCurveTo(-4.0, 0, -2.8, -0.75)
  const hole = new THREE.Path()
  hole.moveTo(-2.7, -0.5); hole.quadraticCurveTo(-3.5, 0, -2.7, 0.5)
  hole.lineTo(2.7, 0.5); hole.quadraticCurveTo(3.5, 0, 2.7, -0.5); hole.lineTo(-2.7, -0.5)
  ring.holes.push(hole)
  group.traverse((obj) => {
    if (!obj.isMesh) return
    const p = obj.geometry.parameters
    if (obj.geometry.type === 'BoxGeometry' && p.width === 0.9 && p.depth === 7.6) {
      obj.geometry = new THREE.ExtrudeGeometry(ring, { depth: 0.85, bevelEnabled: false, curveSegments: 8 }).translate(0, 0, -0.425).rotateY(Math.PI / 2)
    } else if (obj.geometry.type === 'BoxGeometry') {
      obj.geometry = new RoundedBoxGeometry(p.width, p.height, p.depth, 2, Math.min(0.1, p.width / 5, p.height / 5, p.depth / 5))
    }
    if (obj.material.metalness === 0.55) obj.material = obj.material.color.g > 0.22 ? armor : darkArmor
    obj.castShadow = obj.receiveShadow = true
  })
  const add = (geometry, material, x, y, z, parent = group) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const pads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.92, 0.09, 0.27), metal, 96)
  const dummy = new THREE.Object3D()
  let index = 0
  for (const side of [-1, 1]) {
    for (const y of [0.14, 1.61]) for (let i = 0; i < 24; i++) {
      dummy.position.set(side * 2.05, y, -3.0 + i * 6 / 23)
      dummy.updateMatrix(); pads.setMatrixAt(index++, dummy.matrix)
    }
    for (let i = 0; i < 6; i++) {
      const hub = add(new THREE.CylinderGeometry(0.31, 0.31, 0.07, 16).rotateZ(Math.PI / 2), armor, side * 2.33, 0.72, -2.8 + i * 5.6 / 5)
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 10).rotateZ(Math.PI / 2), metal, side * 0.06, 0, 0, hub)
    }
    const crate = add(new RoundedBoxGeometry(0.72, 0.65, 1.6, 2, 0.05), wood, side * 1.35, 2.7, -2.4)
    for (const z of [-0.5, 0.5]) add(new THREE.BoxGeometry(0.76, 0.68, 0.06), metal, 0, 0, z, crate)
    add(new RoundedBoxGeometry(0.45, 0.7, 0.8, 2, 0.08), darkArmor, side * 1.35, 2.65, -3.35)
  }
  pads.castShadow = true
  group.add(pads)
  for (let i = 0; i < 12; i++) add(new THREE.BoxGeometry(0.9, 0.06, 0.07), metal, 0, 2.55, -1.0 - i * 0.13)
  const turret = group.userData.turret
  add(new THREE.CylinderGeometry(0.035, 0.025, 2.8, 5), metal, 1.15, 2.0, -1.2, turret)
  add(new THREE.CylinderGeometry(0.55, 0.6, 0.16, 20), armor, -0.6, 1.18, -0.3, turret)
  const pivot = new THREE.Group()
  pivot.position.set(0, 0.5, 1.5)
  turret.add(pivot)
  for (const child of [...turret.children]) {
    if (child.isMesh && child.geometry.type === 'CylinderGeometry' && child.position.z > 3) pivot.attach(child)
  }
  group.userData.gun = pivot
  group.userData.gunBase = 0
  group.userData.wheels = group.children.filter((obj) => obj.isMesh && obj.geometry.type === 'CylinderGeometry' && obj.position.y < 1.2)
  return group
}

export function palmGeometry() {
  const geometries = []
  const addFrond = (angle, len, rise, droop, baseY) => {
    const positions = [], uvs = [], indices = []
    for (let step = 0; step <= 9; step++) {
      const t = step / 9, radius = t * len
      const y = baseY + Math.sin(t * Math.PI) * rise - t * t * droop
      const width = Math.sin(t * Math.PI) * 0.62 + 0.025
      for (const side of [-1, 1]) {
        positions.push(Math.cos(angle) * radius - Math.sin(angle) * width * side, y, Math.sin(angle) * radius + Math.cos(angle) * width * side)
        uvs.push(side < 0 ? 0 : 1, t)
      }
      if (step < 9) { const i = step * 2; indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3) }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(indices); geo.computeVertexNormals(); geometries.push(geo)
  }
  // fuller crown: 14 outer drooping fronds, 5 upright new shoots, 7 low skirt
  for (let i = 0; i < 14; i++) addFrond(i * Math.PI * 2 / 14, 4.0 + (i % 3) * 0.35, 1.4, 1.8 + (i % 2) * 0.5, 5.05)
  for (let i = 0; i < 5; i++) addFrond(i * Math.PI * 2 / 5 + 0.3, 2.4, 2.6, -0.6, 5.2)
  for (let i = 0; i < 7; i++) addFrond(i * Math.PI * 2 / 7 + 0.15, 3.2, 0.6, 2.6, 4.9)
  return mergeGeometries(geometries)
}

// layered pine for the snow map: three stacked cones, wider skirts at the base
export function pineGeometry() {
  const geos = []
  for (const [r, y0, h] of [[2.7, 2.6, 3.4], [2.0, 5.0, 3.0], [1.3, 7.2, 2.6]]) {
    geos.push(new THREE.ConeGeometry(r, h, 9).translate(0, y0 + h / 2, 0))
  }
  return mergeGeometries(geos)
}

// broadleaf oak canopy: flattened icosahedron blobs clustered into a crown
export function oakGeometry() {
  const geos = []
  const blobs = [[0, 5.4, 0, 2.7], [1.7, 4.9, 0.6, 1.9], [-1.6, 5.0, -0.5, 1.8], [0.6, 4.5, -1.4, 1.6], [-0.6, 4.6, 1.5, 1.6], [0.1, 6.4, 0.3, 1.9]]
  for (const [x, y, z, r] of blobs) geos.push(new THREE.IcosahedronGeometry(r, 1).scale(1, 0.7, 1).translate(x, y, z))
  return mergeGeometries(geos)
}

export function buildCoastalOutpost() {
  const group = new THREE.Group()
  const blue = new THREE.MeshStandardMaterial({ color: 0x527e88, roughness: 0.8 })
  const roof = new THREE.MeshStandardMaterial({ color: 0x633e2b, metalness: 0.15, roughness: 0.8 })
  const frame = new THREE.MeshStandardMaterial({ color: 0xd8c594, roughness: 0.9 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x17252a, roughness: 0.5 })
  const add = (geometry, material, x, y, z) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); group.add(mesh); return mesh }
  add(new THREE.BoxGeometry(13, 5.2, 10), blue, 0, 2.6, 0)
  for (const side of [-1, 1]) {
    const panel = add(new THREE.BoxGeometry(14, 0.25, 6.2), roof, 0, 5.8, side * 2.6)
    panel.rotation.x = side * 0.25
    for (const x of [-4, 0, 4]) {
      add(new THREE.BoxGeometry(2.8, 2.2, 0.2), frame, x, 3.1, side * 5.08)
      add(new THREE.BoxGeometry(2.4, 1.8, 0.22), dark, x, 3.1, side * 5.2)
    }
  }
  for (let i = 0; i < 23; i++) add(new THREE.BoxGeometry(0.055, 5.2, 10.08), frame, -6.5 + i * 13 / 22, 2.6, 0)
  add(new THREE.BoxGeometry(2.4, 3.5, 0.25), dark, 4.5, 1.75, 5.23)
  for (const x of [-11, -7]) for (const z of [-3, 1]) add(new THREE.BoxGeometry(0.24, 10, 0.24), frame, x, 5, z)
  add(new THREE.BoxGeometry(5.2, 0.4, 5.2), roof, -9, 8, -1)
  add(new THREE.CylinderGeometry(2, 2, 3.2, 16), blue, -9, 10, -1)
  const batches = new Map()
  group.updateMatrixWorld(true)
  for (const mesh of group.children) {
    if (!batches.has(mesh.material)) batches.set(mesh.material, [])
    batches.get(mesh.material).push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld))
    mesh.geometry.dispose()
  }
  group.clear()
  for (const [material, geometries] of batches) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material)
    for (const geo of geometries) geo.dispose()
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}
