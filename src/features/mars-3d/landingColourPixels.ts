/**
 * The landing rating's colours as texture bytes. Pure, so the
 * colours and the clear cells are tested without a GPU.
 *
 * The hues are the slope bands' (`--color-slope-*` in index.css):
 * apart from the classification hues, told apart with colour-vision
 * differences, and named in the legend beside them. A texture cannot read
 * a CSS variable, so they are repeated here; the test pins them together.
 */
export const LANDING_COLOUR_RGB: Record<1 | 2 | 3, readonly [number, number, number]> = {
  1: [0x16, 0xa3, 0x4a],
  2: [0xea, 0xb3, 0x08],
  3: [0xef, 0x44, 0x44],
}

/** How solid a rated cell is drawn, 0–255: enough to read on every base layer, with the ground still showing through. */
export const LANDING_COLOUR_ALPHA = 115

/**
 * RGBA bytes for `rating` (0 no rating, 1 green, 2 yellow, 3 red), one
 * texel per cell in the same order. A cell with no rating, or a code this
 * does not know, is fully clear: no colour is ever drawn for it.
 */
export function landingColourPixels(rating: ArrayLike<number>): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(rating.length * 4)
  for (let k = 0; k < rating.length; k++) {
    const code = rating[k]
    if (code !== 1 && code !== 2 && code !== 3) continue
    const [r, g, b] = LANDING_COLOUR_RGB[code]
    out[k * 4] = r
    out[k * 4 + 1] = g
    out[k * 4 + 2] = b
    out[k * 4 + 3] = LANDING_COLOUR_ALPHA
  }
  return out
}
