import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { onSimEvent } from '../lib/live'
import { useTheme } from '../lib/theme'
import { ENGINE_ORBITS, type OrbitEngine } from '../data/engines'

/**
 * Fig. 1 — a stippled ink globe drawn like a technical illustration: dotted sphere, graticule,
 * orbit lines and flat engine markers. Grey arcs are ambient; orange arcs are real
 * `order.committed` events from the showcase API (PostgreSQL → MongoDB projection).
 */

/* scratch objects (never allocate inside useFrame) */
const V1 = new THREE.Vector3()
const V2 = new THREE.Vector3()
const V3 = new THREE.Vector3()
const Q = new THREE.Quaternion()

const R = 2.35
const RIPPLES = 6

type Spawn = { from: string; to: string | null; color: string; alpha: number; ripple: boolean; speed?: number }

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const sphereVert = /* glsl */ `
  uniform float uTime;
  uniform float uPixel;
  uniform float uFade;
  uniform vec4 uRipples[${RIPPLES}];
  attribute float aRand;
  varying float vAlpha;
  varying float vWave;

  void main() {
    vec3 n = normalize(position);
    float t = uTime;
    float breathe = sin(n.x * 3.1 + t * 0.45) * sin(n.y * 3.7 + t * 0.35) * sin(n.z * 2.8 + t * 0.5);
    float wave = 0.0;
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 r = uRipples[i];
      float age = t - r.w;
      if (r.w > 0.0 && age > 0.0 && age < 3.2) {
        float ang = acos(clamp(dot(n, normalize(r.xyz)), -1.0, 1.0));
        wave += exp(-pow((ang - age * 1.2) * 7.0, 2.0)) * exp(-age * 0.9);
      }
    }
    vec3 p = n * (${R.toFixed(2)} * (1.0 + 0.03 * breathe) + wave * 0.16);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (2.1 + aRand * 1.5 + wave * 3.4) * uPixel * (9.0 / -mv.z);

    float facing = clamp(dot(normalize(-mv.xyz), normalize((modelViewMatrix * vec4(n, 0.0)).xyz)), 0.0, 1.0);
    vAlpha = (0.3 + 0.7 * facing) * (0.8 + 0.2 * aRand) * uFade;
    vWave = clamp(wave * 1.8, 0.0, 1.0);
  }
`
const sphereFrag = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uAccent;
  varying float vAlpha;
  varying float vWave;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.38, d);
    gl_FragColor = vec4(mix(uInk, uAccent, vWave), a * min(1.0, vAlpha + vWave * 0.6));
  }
`

function fibonacciSphere(n: number) {
  const pos = new Float32Array(n * 3)
  const rand = new Float32Array(n)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const th = golden * i
    pos[i * 3] = Math.cos(th) * r
    pos[i * 3 + 1] = y
    pos[i * 3 + 2] = Math.sin(th) * r
    rand[i] = Math.random()
  }
  return { pos, rand }
}

function circle(radius: number, seg = 128, y = 0) {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius))
  }
  return new THREE.BufferGeometry().setFromPoints(pts)
}

function Scene({
  labels,
  spawnQueue,
  reduced,
  dense,
  ink,
  accent,
  engineColors,
}: {
  labels: React.RefObject<(HTMLDivElement | null)[]>
  spawnQueue: React.RefObject<Spawn[]>
  reduced: boolean
  dense: boolean
  ink: string
  accent: string
  engineColors: Record<string, string>
}) {
  const { gl, camera, size } = useThree()
  const group = useRef<THREE.Group>(null)
  const core = useRef<THREE.LineSegments>(null)
  const sats = useRef<(THREE.Group | null)[]>([])
  const rippleIdx = useRef(0)
  const lastAmbient = useRef(0)
  const pointer = useRef({ x: 0, y: 0 })

  const N = dense ? 5200 : 2600
  const { pos, rand } = useMemo(() => fibonacciSphere(N), [N])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPixel: { value: Math.min(gl.getPixelRatio(), 2) },
      uFade: { value: 1 },
      uInk: { value: new THREE.Color(ink) },
      uAccent: { value: new THREE.Color(accent) },
      uRipples: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 1, 0, -10)) },
    }),
    [gl, ink, accent],
  )

  const orbitQuats = useMemo(() => ENGINE_ORBITS.map((o) => new THREE.Quaternion().setFromEuler(new THREE.Euler(o.tilt[0], o.tilt[1], o.tilt[2]))), [])

  // graticule: latitudes + meridians, like a drawn globe
  const graticule = useMemo(() => {
    const lats = [-60, -30, 0, 30, 60].map((deg) => {
      const phi = (deg * Math.PI) / 180
      return circle(R * Math.cos(phi), 128, R * Math.sin(phi))
    })
    const meridians = [0, 30, 60, 90, 120, 150].map((deg) => {
      const g = circle(R, 128)
      g.rotateX(Math.PI / 2)
      g.rotateY((deg * Math.PI) / 180)
      return g
    })
    return [...lats, ...meridians]
  }, [])

  const rings = useMemo(() => {
    const uniq = new Map<string, OrbitEngine>()
    ENGINE_ORBITS.forEach((o) => uniq.set(`${o.r}-${o.tilt.join(',')}`, o))
    return [...uniq.values()].map((o) => {
      const pts: number[] = []
      for (let i = 0; i <= 200; i++) {
        const a = (i / 200) * Math.PI * 2
        pts.push(Math.cos(a) * o.r, 0, Math.sin(a) * o.r)
      }
      const geo = new LineGeometry()
      geo.setPositions(pts)
      const mat = new LineMaterial({ color: ink, linewidth: o.core ? 1.6 : 1.3, transparent: true, opacity: o.core ? 0.85 : 0.6, dashed: !o.core, dashSize: 0.12, gapSize: 0.09 })
      const line = new Line2(geo, mat)
      line.computeLineDistances()
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.tilt[0], o.tilt[1], o.tilt[2]))
      return { line, q }
    })
  }, [ink])

  // comet arcs between engines
  const POOL = 22
  const SEG = 48
  const packets = useMemo(
    () =>
      Array.from({ length: POOL }, () => {
        const geo = new LineGeometry()
        geo.setPositions(new Float32Array(SEG * 3))
        geo.instanceCount = 0
        const mat = new LineMaterial({ color: ink, linewidth: 2, transparent: true, opacity: 1, depthWrite: false })
        const line = new Line2(geo, mat)
        line.frustumCulled = false
        const head = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), new THREE.MeshBasicMaterial({ color: ink, transparent: true, depthWrite: false }))
        return { line, head, curve: new THREE.QuadraticBezierCurve3(), t: 1, speed: 0.7, active: false, alpha: 1, width: 2 }
      }),
    [ink],
  )

  const satPos = (i: number, time: number, out: THREE.Vector3) => {
    const o = ENGINE_ORBITS[i]
    const a = o.phase + time * o.speed
    out.set(Math.cos(a) * o.r, 0, Math.sin(a) * o.r).applyQuaternion(orbitQuats[i])
    return out
  }

  const fire = (s: Spawn, time: number) => {
    const p = packets.find((k) => !k.active)
    if (!p) return
    const fi = ENGINE_ORBITS.findIndex((e) => e.key === s.from)
    if (fi < 0) return
    const ti = s.to ? ENGINE_ORBITS.findIndex((e) => e.key === s.to) : -1
    const a = satPos(fi, time, new THREE.Vector3())
    const b = ti >= 0 ? satPos(ti, time + 1.2, new THREE.Vector3()) : V3.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(R).clone()
    const mid = a.clone().add(b).multiplyScalar(0.5)
    const lift = mid.length() < 0.2 ? new THREE.Vector3(0, 1, 0) : mid.clone().normalize()
    p.curve.v0.copy(a)
    p.curve.v1.copy(lift.multiplyScalar(Math.max(R * 1.7, mid.length() + 1.3)))
    p.curve.v2.copy(b)
    // write segments in place: [start.xyz, end.xyz] per instance — no per-fire GPU allocations
    const start = p.line.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
    const arr = start.data.array as Float32Array
    for (let k = 0; k < SEG - 1; k++) {
      p.curve.getPoint(k / (SEG - 1), V1)
      p.curve.getPoint((k + 1) / (SEG - 1), V2)
      arr[k * 6] = V1.x
      arr[k * 6 + 1] = V1.y
      arr[k * 6 + 2] = V1.z
      arr[k * 6 + 3] = V2.x
      arr[k * 6 + 4] = V2.y
      arr[k * 6 + 5] = V2.z
    }
    start.data.needsUpdate = true
    const lm = p.line.material as LineMaterial
    lm.color.set(s.color)
    lm.linewidth = s.alpha >= 0.9 ? 3 : 1.5
    ;(p.head.material as THREE.MeshBasicMaterial).color.set(s.color)
    p.alpha = s.alpha
    p.t = 0
    p.speed = s.speed ?? 0.75
    p.active = true
    if (s.ripple) {
      const r = uniforms.uRipples.value[rippleIdx.current++ % RIPPLES]
      V2.copy(a).normalize()
      r.set(V2.x, V2.y, V2.z, uniforms.uTime.value)
    }
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / innerWidth) * 2 - 1
      pointer.current.y = (e.clientY / innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => window.removeEventListener('pointermove', move)
  }, [])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const dt = Math.min(delta, 0.05)
    uniforms.uTime.value = t
    const scroll = Math.min(1.4, window.scrollY / Math.max(1, innerHeight))

    // ≥ 900 px: globe lives right of the copy; narrower: centred above it
    const wide = size.width >= 900
    const halfW = Math.tan((19 * Math.PI) / 180) * 9.6 * (size.width / size.height)
    const g = group.current
    if (g) {
      const targetX = wide ? halfW * 0.52 : 0
      const targetY = (wide ? 0.05 : 0.9) + scroll * 1.4
      const baseScale = wide ? Math.min(0.86, (halfW * 0.52) / (R * 1.08)) : Math.min(1, size.width / 560) * 0.78
      g.position.x += (targetX - g.position.x) * 0.08
      g.position.y += (targetY - g.position.y) * 0.08
      g.scale.setScalar(baseScale * (1 + scroll * 0.25))
      const rx = reduced ? 0 : pointer.current.y * 0.18
      const ry = reduced ? 0 : pointer.current.x * 0.28
      g.rotation.x += (rx + 0.2 - g.rotation.x) * 0.04
      g.rotation.y += (ry + t * (reduced ? 0.015 : 0.045) - g.rotation.y) * 0.04
    }
    uniforms.uFade.value = Math.max(0, 1 - scroll * 0.8)
    if (core.current) {
      core.current.rotation.y = -t * 0.1
      core.current.rotation.z = t * 0.04
    }

    const labelEls = labels.current
    for (let i = 0; i < ENGINE_ORBITS.length; i++) {
      const s = sats.current[i]
      if (!s) continue
      satPos(i, t, s.position)
      s.quaternion.copy(camera.quaternion)
      if (g) {
        s.quaternion.premultiply(Q.copy(g.quaternion).invert())
        V1.copy(s.position).applyMatrix4(g.matrixWorld)
        s.scale.setScalar(V1.distanceTo(camera.position) / 9.6 / Math.max(0.86, g.scale.x))
      }
      const el = labelEls?.[i]
      if (el && g) {
        V1.copy(s.position).applyMatrix4(g.matrixWorld)
        V2.copy(V1).project(camera)
        const x = (V2.x * 0.5 + 0.5) * size.width
        const y = (-V2.y * 0.5 + 0.5) * size.height
        V3.setFromMatrixPosition(g.matrixWorld)
        const behind = V1.distanceTo(camera.position) > V3.distanceTo(camera.position) + 0.4
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
        el.style.opacity = String(Math.max(0, (behind ? 0.55 : 1) * (1 - scroll * 1.6)))
      }
    }

    const q = spawnQueue.current
    while (q && q.length) fire(q.shift()!, t)
    if (!reduced && t - lastAmbient.current > 1.1) {
      lastAmbient.current = t
      const a = ENGINE_ORBITS[Math.floor(Math.random() * ENGINE_ORBITS.length)]
      fire({ from: a.key, to: null, color: ink, alpha: 0.55, ripple: false, speed: 0.5 }, t)
    }
    for (const p of packets) {
      if (!p.active) {
        p.line.visible = false
        p.head.visible = false
        continue
      }
      p.t += dt * p.speed
      const tt = Math.min(1, p.t)
      p.line.geometry.instanceCount = Math.max(1, Math.floor(tt * (SEG - 1)))
      p.line.visible = true
      p.curve.getPoint(tt, p.head.position)
      p.head.lookAt(camera.position)
      p.head.visible = tt < 1
      const fade = tt < 1 ? 1 : Math.max(0, 1 - (p.t - 1) * 1.8)
      ;(p.line.material as LineMaterial).opacity = p.alpha * fade
      ;(p.head.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p.alpha * 1.4) * fade
      if (p.t >= 1.6) p.active = false
    }
  })

  return (
    <group ref={group}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[pos, 3]} />
          <bufferAttribute attach="attributes-aRand" args={[rand, 1]} />
        </bufferGeometry>
        <shaderMaterial vertexShader={sphereVert} fragmentShader={sphereFrag} uniforms={uniforms} transparent depthWrite={false} />
      </points>

      {graticule.map((geo, i) => (
        <lineLoop key={i} geometry={geo}>
          <lineBasicMaterial color={ink} transparent opacity={i === 2 ? 0.5 : 0.22} depthWrite={false} />
        </lineLoop>
      ))}

      <lineSegments ref={core}>
        <wireframeGeometry args={[new THREE.IcosahedronGeometry(1.0, 1)]} />
        <lineBasicMaterial color={ink} transparent opacity={0.3} />
      </lineSegments>

      {rings.map((r, i) => (
        <group key={i} quaternion={r.q}>
          <primitive object={r.line} />
        </group>
      ))}

      {ENGINE_ORBITS.map((e, i) => (
        <group key={e.key} ref={(el) => void (sats.current[i] = el)}>
          <mesh renderOrder={2}>
            <circleGeometry args={[e.core ? 0.16 : 0.13, 32]} />
            <meshBasicMaterial color={ink} depthTest={false} />
          </mesh>
          <mesh renderOrder={3}>
            <circleGeometry args={[e.core ? 0.125 : 0.1, 32]} />
            <meshBasicMaterial color={engineColors[e.key] ?? e.color} depthTest={false} />
          </mesh>
        </group>
      ))}

      {packets.map((p, i) => (
        <group key={i}>
          <primitive object={p.line} />
          <primitive object={p.head} />
        </group>
      ))}
    </group>
  )
}

export function HeroScene({ active, reduced }: { active: boolean; reduced: boolean }) {
  const labels = useRef<(HTMLDivElement | null)[]>([])
  const spawnQueue = useRef<Spawn[]>([])
  const dense = useMemo(() => typeof window !== 'undefined' && window.innerWidth > 900 && (navigator.hardwareConcurrency ?? 4) >= 4, [])
  const theme = useTheme()
  // re-read the CSS tokens whenever the theme flips
  const palette = useMemo(
    () => ({
      theme,
      ink: cssVar('--fg', '#161512'),
      accent: cssVar('--accent', '#d9480f'),
      warn: cssVar('--amber', '#a86a00'),
      bad: cssVar('--rose', '#c21f3a'),
      info: cssVar('--sky', '#2456a6'),
      engines: Object.fromEntries(ENGINE_ORBITS.map((e) => [e.key, cssVar('--' + e.key, e.color)])),
    }),
    [theme],
  )

  useEffect(
    () =>
      onSimEvent((ev) => {
        const q = spawnQueue.current
        if (q.length > 12) return
        switch (ev.type) {
          case 'order.committed':
            q.push({ from: 'pg', to: 'mg', color: palette.accent, alpha: 1, ripple: true, speed: 0.6 })
            break
          case 'event.duplicate_ignored':
            q.push({ from: 'mg', to: null, color: palette.warn, alpha: 0.9, ripple: false, speed: 0.9 })
            break
          case 'consumer.crashed':
          case 'resume_token.invalid':
          case 'ha.primary_down':
            q.push({ from: 'pg', to: null, color: palette.bad, alpha: 1, ripple: true, speed: 0.5 })
            break
          case 'reconcile.completed':
          case 'resync.completed':
            q.push({ from: 'pg', to: 'mg', color: palette.info, alpha: 1, ripple: true, speed: 0.5 })
            break
        }
      }),
    [palette],
  )

  return (
    <div className="hero-canvas" aria-hidden>
      <Canvas
        flat
        frameloop={active ? 'always' : 'never'}
        dpr={[1, 2]}
        camera={{ position: [0, 0, 9.6], fov: 38, near: 0.1, far: 60 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <Scene
          key={palette.theme}
          labels={labels}
          spawnQueue={spawnQueue}
          reduced={reduced}
          dense={dense}
          ink={palette.ink}
          accent={palette.accent}
          engineColors={palette.engines}
        />
      </Canvas>
      <div className="sat-labels">
        {ENGINE_ORBITS.map((e, i) => (
          <div key={e.key} className="sat-label" ref={(el) => void (labels.current[i] = el)} style={{ ['--c' as string]: `var(--${e.key})` }}>
            <i />
            <span>{e.name}</span>
            {e.core && <em>core</em>}
          </div>
        ))}
      </div>
    </div>
  )
}
