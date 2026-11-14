import { LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, type DataTexture, type Texture } from 'three'

/** Repeating, mipmapped and filtered: DataTexture defaults to nearest, which shimmers at a distance. */
export function tilingTexture(tex: DataTexture, anisotropy: number): Texture {
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.magFilter = LinearFilter
  tex.minFilter = LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = anisotropy
  tex.needsUpdate = true
  return tex
}
