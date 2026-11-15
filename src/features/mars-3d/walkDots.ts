import { CanvasTexture, SRGBColorSpace } from 'three'

/** The sprite's own size; drawn smaller, so its edge stays smooth. */
const TEXTURE_PX = 32

/**
 * A dot filled with `fill` and a dark rim, readable on every layer, as the
 * route's dots are. `hollow` leaves the middle clear: a ring, for the
 * landing site, so it never reads as a stop or a sample.
 */
export function createDotTexture(fill: string, hollow = false): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_PX
  canvas.height = TEXTURE_PX
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const c = TEXTURE_PX / 2
    ctx.beginPath()
    ctx.arc(c, c, c * 0.72, 0, Math.PI * 2)
    ctx.lineWidth = c * 0.32
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
    ctx.stroke()
    if (hollow) {
      ctx.lineWidth = c * 0.16
      ctx.strokeStyle = fill
      ctx.stroke()
    } else {
      ctx.fillStyle = fill
      ctx.fill()
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** "#rrggbb" for a 0xrrggbb colour. */
export const hexCss = (n: number) => `#${n.toString(16).padStart(6, '0')}`
