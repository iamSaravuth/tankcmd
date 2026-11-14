import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'

export class EnvironmentMaterials {
  constructor(renderer, scene, mobile) {
    this.renderer = renderer
    this.scene = scene
    this.mobile = mobile
    this.textures = new Map()
    this.disposed = false
    this.loader = new THREE.TextureLoader()
    this.anisotropy = Math.min(mobile ? 4 : 8, renderer.capabilities.getMaxAnisotropy())
    this.loadSky()
  }

  texture(name, color = false, repeatX = 1, repeatY = repeatX) {
    const key = `${name}:${repeatX}:${repeatY}`
    if (this.textures.has(key)) return this.textures.get(key)
    const cv = document.createElement('canvas')
    cv.width = cv.height = color && !this.mobile ? 1024 : 512
    const ctx = cv.getContext('2d')
    ctx.fillStyle = color ? '#bdb9ad' : '#8080ff'
    ctx.fillRect(0, 0, cv.width, cv.height)
    const texture = new THREE.CanvasTexture(cv)
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeatX, repeatY)
    texture.anisotropy = this.anisotropy
    this.textures.set(key, texture)
    this.loader.load(`${import.meta.env.BASE_URL}assets/textures/${name}.jpg`, (loaded) => {
      if (!this.disposed) {
        ctx.drawImage(loaded.image, 0, 0, cv.width, cv.height)
        texture.needsUpdate = true
      }
      loaded.dispose()
    }, undefined, () => { if (!this.disposed) console.warn(`Texture unavailable: ${name}`) })
    return texture
  }

  loadSky() {
    new HDRLoader().load(`${import.meta.env.BASE_URL}assets/textures/sky.hdr`, (sky) => {
      if (this.disposed) { sky.dispose(); return }
      sky.mapping = THREE.EquirectangularReflectionMapping
      const pmrem = new THREE.PMREMGenerator(this.renderer)
      this.environment = pmrem.fromEquirectangular(sky)
      pmrem.dispose()
      this.sky = sky
      this.scene.background = sky
      this.scene.backgroundIntensity = 0.8
      this.scene.environment = this.environment.texture
      this.scene.environmentIntensity = 0.55
      const material = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false,
        uniforms: { skyMap: { value: sky }, horizon: { value: this.scene.fog.color.clone() } },
        vertexShader: `varying vec3 vSkyDirection;
          void main() {
            vSkyDirection = position;
            vec4 clip = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
            gl_Position = clip.xyww;
          }`,
        fragmentShader: `uniform sampler2D skyMap; uniform vec3 horizon; varying vec3 vSkyDirection;
          void main() {
            vec3 direction = normalize(vSkyDirection);
            vec2 uv = vec2(atan(direction.z, direction.x) * 0.159154943 + 0.5, asin(clamp(direction.y, -1.0, 1.0)) * 0.318309886 + 0.5);
            vec3 color = texture2D(skyMap, uv).rgb * 0.8;
            gl_FragColor = vec4(mix(horizon, color, smoothstep(-0.02, 0.12, direction.y)), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      })
      this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material)
      this.skyDome.frustumCulled = false
      this.skyDome.renderOrder = -1000
      this.scene.add(this.skyDome)
    }, undefined, () => { if (!this.disposed) console.warn('Sky texture unavailable; using fallback sky') })
  }

  ground() {
    const dirt = this.texture('dirt-color', true), rock = this.texture('rock-color', true)
    const dirtNormal = this.texture('dirt-normal'), rockNormal = this.texture('rock-normal')
    const material = new THREE.MeshStandardMaterial({
      map: this.texture('ground-color', true), normalMap: this.texture('ground-normal'),
      normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.93, color: 0xe2d29a,
    })
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { terrainDirt: { value: dirt }, terrainRock: { value: rock }, terrainDirtNormal: { value: dirtNormal }, terrainRockNormal: { value: rockNormal } })
      shader.vertexShader = `attribute vec2 terrainBlend; varying vec2 vTerrainBlend;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainBlend = terrainBlend;')
      shader.fragmentShader = `uniform sampler2D terrainDirt; uniform sampler2D terrainRock; uniform sampler2D terrainDirtNormal; uniform sampler2D terrainRockNormal; varying vec2 vTerrainBlend;\n${shader.fragmentShader}`
        .replace('#include <map_fragment>', `
          vec4 groundTexel = texture2D(map, vMapUv);
          vec4 dirtTexel = texture2D(terrainDirt, vMapUv * 0.9);
          vec4 rockTexel = texture2D(terrainRock, vMapUv * 0.55);
          diffuseColor *= mix(mix(groundTexel, dirtTexel, vTerrainBlend.x), rockTexel, vTerrainBlend.y);
        `)
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(
          'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          `vec3 groundN = texture2D(normalMap, vNormalMapUv).xyz;
           vec3 dirtN = texture2D(terrainDirtNormal, vNormalMapUv * 0.9).xyz;
           vec3 rockN = texture2D(terrainRockNormal, vNormalMapUv * 0.55).xyz;
           vec3 mapN = mix(mix(groundN, dirtN, vTerrainBlend.x), rockN, vTerrainBlend.y) * 2.0 - 1.0;`
        ))
    }
    material.customProgramCacheKey = () => 'terrain-pbr-blend-v1'
    return material
  }

  armor(color) {
    if (!this.textures.has('armor')) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 256
      const ctx = cv.getContext('2d')
      ctx.fillStyle = '#d5d1ba'; ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 2200; i++) {
        const x = (i * 73.37) % 256, y = (i * 31.13) % 256
        ctx.fillStyle = i % 7 === 0 ? '#6f6c5728' : '#fffae00c'
        ctx.fillRect(x, y, i % 9 === 0 ? 5 : 1, 1)
      }
      const texture = new THREE.CanvasTexture(cv)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping
      this.textures.set('armor', texture)
    }
    return new THREE.MeshStandardMaterial({ color, map: this.textures.get('armor'), normalMap: this.texture('rock-normal'), normalScale: new THREE.Vector2(0.055, 0.055), roughness: 0.58, metalness: 0.28 })
  }

  palmFoliage() {
    if (!this.textures.has('palm')) {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512
      const ctx = cv.getContext('2d')
      ctx.strokeStyle = '#9caa42'; ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 512); ctx.stroke()
      for (let y = 0; y < 512; y += 8) for (const side of [-1, 1]) {
        ctx.strokeStyle = `hsl(${80 + y % 25}, 48%, ${28 + y % 18}%)`
        ctx.lineWidth = 6
        ctx.beginPath(); ctx.moveTo(128, y); ctx.quadraticCurveTo(128 + side * 70, y + 2, 128 + side * 126, y + 20); ctx.stroke()
      }
      const texture = new THREE.CanvasTexture(cv); texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = this.anisotropy
      this.textures.set('palm', texture)
    }
    return new THREE.MeshStandardMaterial({ map: this.textures.get('palm'), side: THREE.DoubleSide, alphaTest: 0.3, alphaToCoverage: true, roughness: 0.85 })
  }

  grass() {
    if (!this.textures.has('grass')) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128
      const ctx = cv.getContext('2d')
      for (let i = 0; i < 42; i++) {
        const x = (i * 31.7) % 128, height = 35 + (i * 17.3) % 80
        ctx.strokeStyle = i % 3 === 0 ? '#c8a646' : '#d5c474'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(64 + (x - 64) * 0.5, 128); ctx.quadraticCurveTo(x, 100, x + Math.sin(i) * 12, 128 - height); ctx.stroke()
      }
      const texture = new THREE.CanvasTexture(cv); texture.colorSpace = THREE.SRGBColorSpace
      this.textures.set('grass', texture)
    }
    return new THREE.MeshStandardMaterial({ map: this.textures.get('grass'), side: THREE.DoubleSide, alphaTest: 0.35, roughness: 1 })
  }

  rock() {
    return new THREE.MeshStandardMaterial({ map: this.texture('rock-color', true), normalMap: this.texture('rock-normal'), normalScale: new THREE.Vector2(0.8, 0.8), color: 0xd1ccc0, roughness: 0.94 })
  }

  bark() {
    return new THREE.MeshStandardMaterial({ map: this.texture('bark-color', true, 1, 2), normalMap: this.texture('bark-normal', false, 1, 2), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.95 })
  }

  foliage() {
    if (!this.textures.has('pine')) {
      const cv = document.createElement('canvas')
      cv.width = 256; cv.height = 512
      const ctx = cv.getContext('2d')
      let seed = 7129
      const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
      ctx.strokeStyle = '#4b4030'; ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(128, 18); ctx.lineTo(128, 505); ctx.stroke()
      for (let level = 0; level < 36; level++) {
        const y = 22 + level * 12.8, span = 7 + level * 2.9
        for (const side of [-1, 1]) {
          const endX = 128 + side * span * (0.8 + random() * 0.2)
          const endY = y + 10 + random() * 15
          ctx.strokeStyle = '#5b5136'; ctx.lineWidth = 2
          ctx.beginPath(); ctx.moveTo(128, y - 7); ctx.lineTo(endX, endY); ctx.stroke()
          for (let twig = 0; twig < 20; twig++) {
            const t = twig / 20, x = 128 + (endX - 128) * t, by = y - 7 + (endY - y + 7) * t
            for (let needle = 0; needle < 5; needle++) {
              const light = 25 + Math.floor(random() * 22)
              ctx.strokeStyle = `hsl(${96 + random() * 26}, ${20 + random() * 20}%, ${light}%)`
              ctx.lineWidth = 1 + random()
              ctx.beginPath(); ctx.moveTo(x, by)
              ctx.lineTo(x + side * (3 + random() * 8), by - 4 - random() * 13)
              ctx.stroke()
            }
          }
        }
      }
      const texture = new THREE.CanvasTexture(cv)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = this.anisotropy
      this.textures.set('pine', texture)
    }
    return new THREE.MeshStandardMaterial({ map: this.textures.get('pine'), side: THREE.DoubleSide, alphaTest: 0.4, alphaToCoverage: true, roughness: 0.95 })
  }

  water() {
    const size = 256, data = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2
      const dx = Math.cos(u * 5 + v * 3) * 0.23 + Math.cos(u * 9 - v * 7) * 0.12
      const dy = Math.cos(u * 5 + v * 3) * 0.14 - Math.cos(u * 9 - v * 7) * 0.1
      const length = Math.hypot(dx, dy, 1), i = (y * size + x) * 4
      data[i] = (dx / length * 0.5 + 0.5) * 255
      data[i + 1] = (dy / length * 0.5 + 0.5) * 255
      data[i + 2] = (1 / length * 0.5 + 0.5) * 255
      data[i + 3] = 255
    }
    const normal = new THREE.DataTexture(data, size, size)
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping
    normal.repeat.set(440, 440)
    normal.minFilter = THREE.LinearMipmapLinearFilter
    normal.magFilter = THREE.LinearFilter
    normal.generateMipmaps = true
    normal.anisotropy = this.anisotropy
    normal.needsUpdate = true
    this.textures.set('water', normal)
    this.waterNormal = normal
    return new THREE.MeshPhysicalMaterial({ color: 0x258eaa, normalMap: normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.2, metalness: 0, clearcoat: this.mobile ? 0 : 0.65, clearcoatRoughness: 0.2, transparent: true, opacity: 0.83, depthWrite: false, envMapIntensity: 1.3 })
  }

  update(dt) {
    if (this.waterNormal) {
      this.waterNormal.offset.x = (this.waterNormal.offset.x + dt * 0.025) % 1
      this.waterNormal.offset.y = (this.waterNormal.offset.y + dt * 0.013) % 1
    }
  }

  dispose() {
    this.disposed = true
    for (const texture of this.textures.values()) texture.dispose()
    this.textures.clear()
    this.scene.background = null
    this.scene.environment = null
    if (this.skyDome) {
      this.scene.remove(this.skyDome)
      this.skyDome.geometry.dispose()
      this.skyDome.material.dispose()
    }
    this.sky?.dispose()
    this.environment?.dispose()
  }
}
