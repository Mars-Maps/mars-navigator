import type { Material, Object3D, Texture } from 'three'

/**
 * The texture half of the performance probe's report: every texture
 * the scene graph references, once each, with its size and an estimate of
 * its GPU memory. Walks materials' own maps and ShaderMaterial uniforms.
 * Testable without WebGL; nothing here touches the renderer.
 */

/** The probe is on when the URL carries `?perf`, in any build. Off by default. */
export function isPerfEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('perf')
}

export interface TextureRow {
  /** Where it was found: the owning object's type and name, first hit only. */
  owner: string
  width: number
  height: number
  mipmaps: boolean
  /** RGBA8 bytes, ×4/3 with mipmaps. An estimate, not a driver reading. */
  estimatedBytes: number
}

interface Sized {
  width?: number
  height?: number
}

function texturesOf(material: Material): Texture[] {
  const found: Texture[] = []
  for (const value of Object.values(material)) {
    if ((value as Texture | null)?.isTexture) found.push(value as Texture)
  }
  const uniforms = (material as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms
  if (uniforms) {
    for (const u of Object.values(uniforms)) {
      if ((u.value as Texture | null)?.isTexture) found.push(u.value as Texture)
    }
  }
  return found
}

export function collectTextures(root: Object3D): TextureRow[] {
  const seen = new Set<Texture>()
  const rows: TextureRow[] = []
  root.traverse((object) => {
    const material = (object as Object3D & { material?: Material | Material[] }).material
    if (!material) return
    for (const m of Array.isArray(material) ? material : [material]) {
      for (const texture of texturesOf(m)) {
        if (seen.has(texture)) continue
        seen.add(texture)
        const image = (texture.image ?? {}) as Sized
        const width = image.width ?? 0
        const height = image.height ?? 0
        const mipmaps = texture.generateMipmaps
        rows.push({
          owner: object.name ? `${object.type} "${object.name}"` : object.type,
          width,
          height,
          mipmaps,
          estimatedBytes: Math.round(width * height * 4 * (mipmaps ? 4 / 3 : 1)),
        })
      }
    }
  })
  return rows
}
