import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  Color,
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { sampleHeight, type Heightfield } from './heightfield'
import { anchorPosition, forEachRock, rockCell, rockHash as hash } from './rockLayout'
import type { PatchFrame } from './surfacePatch'

/**
 * SIMULATED rocks and pebbles around the walker (labelled in the view): no
 * data in the app resolves stones, so these are scattered for looks. Two
 * tiers: stones up to boulder size in 16 m cells out to 220 m, and pebbles
 * in 3 m cells out to 45 m (`rockLayout.ts`). Where each lands depends only
 * on its cell in the drop point's frame, so the same stones stay put as the
 * walker moves and across ground patch rebuilds; they are laid out again
 * only when the walker crosses into a new cell or the patch changes.
 *
 * One InstancedMesh, one lumpy geometry. Nothing is allocated per frame;
 * geometry and material are disposed on unmount.
 */
const MAX_ROCKS = 4000
const ROCK_COLORS = ['#5a3f33', '#6b4a3a', '#4a3a33', '#7a5a46', '#3f3330', '#665247'].map((c) => new Color(c))

/** An icosahedron with its vertices pushed in and out, so it reads as a stone. */
function rockGeometry(): IcosahedronGeometry {
  const g = new IcosahedronGeometry(1, 1)
  const pos = g.getAttribute('position')
  // Shared corners must move together, so key the jitter on position.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const key = Math.round(x * 1000) * 73856093 ^ Math.round(y * 1000) * 19349663 ^ Math.round(z * 1000) * 83492791
    const s = 0.75 + 0.5 * hash(key, 0, 0, 5)
    pos.setXYZ(i, x * s, y * s * 0.7, z * s)
  }
  g.computeVertexNormals()
  return g
}

export interface RockSource {
  active: { field: Heightfield; frame: PatchFrame } | null
  /** The drop point's frame: the stones' cell grid. */
  anchor: PatchFrame
  xM: number
  yM: number
}

export function Rocks({ rigRef }: { rigRef: RefObject<RockSource> }) {
  const mesh = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => rockGeometry(), [])
  const material = useMemo(() => new MeshLambertMaterial({ flatShading: true }), [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  const scratch = useMemo(
    () => ({ m: new Matrix4(), q: new Quaternion(), e: new Euler(), p: new Vector3(), s: new Vector3() }),
    [],
  )
  /** What the instances were last laid out for; a new mesh, patch or cell lays them out again. */
  const built = useRef<{ mesh: InstancedMesh | null; field: Heightfield | null; ci: number; cj: number }>({
    mesh: null,
    field: null,
    ci: NaN,
    cj: NaN,
  })

  useFrame(() => {
    const target = mesh.current
    const rig = rigRef.current
    const active = rig?.active ?? null
    const field = active?.field ?? null
    if (!target || !rig || !active || !field) return
    const at = anchorPosition(rig.anchor, active.frame, rig.xM, rig.yM)
    const { ci, cj } = rockCell(at.xM, at.yM)
    const b = built.current
    if (b.mesh === target && b.field === field && b.ci === ci && b.cj === cj) return
    b.mesh = target
    b.field = field
    b.ci = ci
    b.cj = cj

    const { m, q, e, p, s } = scratch
    const n = forEachRock(rig.anchor, active.frame, rig.xM, rig.yM, MAX_ROCKS, (rock, index) => {
      const { tier, i, j, k, xM: x, yM: y, radiusM: r } = rock
      const h = sampleHeight(field, x, y)
      // Partly buried, as stones on Mars usually are.
      p.set(x, h - r * 0.25, -y)
      e.set(
        (hash(i, j, k * 7 + 4, tier.seed) - 0.5) * 0.5,
        hash(i, j, k * 7 + 5, tier.seed) * Math.PI * 2,
        (hash(i, j, k * 7 + 6, tier.seed) - 0.5) * 0.5,
      )
      q.setFromEuler(e)
      const stretch = 0.75 + 0.5 * hash(i, j, k * 7 + 7, tier.seed)
      s.set(r * stretch, r * (0.6 + 0.4 * hash(i, j, k, tier.seed + 1)), r / stretch)
      m.compose(p, q, s)
      target.setMatrixAt(index, m)
      target.setColorAt(index, ROCK_COLORS[Math.floor(hash(i, j, k, tier.seed + 2) * ROCK_COLORS.length)])
    })
    target.count = n
    target.instanceMatrix.needsUpdate = true
    if (target.instanceColor) target.instanceColor.needsUpdate = true
    target.computeBoundingSphere()
  })

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_ROCKS]} frustumCulled={false} />
}
