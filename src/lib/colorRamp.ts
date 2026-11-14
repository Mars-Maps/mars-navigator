/**
 * A colour ramp: linear interpolation in sRGB between stops ordered by
 * value, clamped at the ends. Generic: knows nothing of what the values
 * are. Used to paint a data grid into pixels and to draw its legend bar.
 */

export interface RampStop {
  value: number
  /** CSS hex, `#rrggbb`. */
  color: string
}

export type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`)
  const n = Number.parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The stops' colours parsed once, for a hot loop. */
export function parseRamp(stops: readonly RampStop[]): { values: Float64Array; colors: Rgb[] } {
  if (stops.length === 0) throw new Error('A ramp needs at least one stop')
  for (let i = 1; i < stops.length; i++) {
    if (!(stops[i].value > stops[i - 1].value)) throw new Error('Ramp stops must rise')
  }
  return { values: Float64Array.from(stops, (s) => s.value), colors: stops.map((s) => hexToRgb(s.color)) }
}

/** The colour for a value: the nearest end's beyond the ends, interpolated between. */
export function rampColor(ramp: ReturnType<typeof parseRamp>, value: number): Rgb {
  const { values, colors } = ramp
  const last = values.length - 1
  if (value <= values[0]) return colors[0]
  if (value >= values[last]) return colors[last]
  let i = 1
  while (values[i] < value) i++
  const t = (value - values[i - 1]) / (values[i] - values[i - 1])
  const a = colors[i - 1]
  const b = colors[i]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/**
 * RGBA pixels for a row-major grid of values, through the ramp; a value
 * that is not finite is transparent, so a gap is a gap and never a colour.
 */
export function paintRamp(values: ArrayLike<number>, stops: readonly RampStop[]): Uint8ClampedArray<ArrayBuffer> {
  const ramp = parseRamp(stops)
  const out = new Uint8ClampedArray(values.length * 4)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) continue
    const [r, g, b] = rampColor(ramp, v)
    const o = i * 4
    out[o] = r
    out[o + 1] = g
    out[o + 2] = b
    out[o + 3] = 255
  }
  return out
}

/** The ramp as a small SVG image, left to right, for a picker's preview tile; a data: URL. */
export function rampSvgDataUrl(stops: readonly RampStop[], width = 64, height = 64): string {
  const lo = stops[0].value
  const span = stops[stops.length - 1].value - lo
  const at = (v: number) => (span > 0 ? ((v - lo) / span) * 100 : 0)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">` +
    stops.map((s) => `<stop offset="${at(s.value).toFixed(1)}%" stop-color="${s.color}"/>`).join('') +
    `</linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** The ramp as a CSS gradient, left to right, stops placed by value. */
export function rampCss(stops: readonly RampStop[]): string {
  const lo = stops[0].value
  const span = stops[stops.length - 1].value - lo
  const at = (v: number) => (span > 0 ? ((v - lo) / span) * 100 : 0)
  return `linear-gradient(to right, ${stops.map((s) => `${s.color} ${at(s.value).toFixed(1)}%`).join(', ')})`
}
