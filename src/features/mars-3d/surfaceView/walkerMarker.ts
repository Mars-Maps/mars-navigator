/**
 * The walker on the overhead map: a dot with a wedge for the
 * way they look, north up. Pure canvas calls, so a test can check what is
 * drawn without a DOM.
 */

/** Sizes in CSS px. */
const WEDGE_PX = 18
const WEDGE_HALF_RAD = 0.45
const DOT_PX = 3.5

/** The dot and look wedge at `x`, `y`; `yawRad` is 0 north, positive clockwise. */
export function drawWalker(ctx: CanvasRenderingContext2D, x: number, y: number, yawRad: number): void {
  ctx.save()
  ctx.translate(x, y)
  // Canvas y runs down, so a clockwise yaw is a positive rotation here too.
  ctx.rotate(yawRad)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.arc(0, 0, WEDGE_PX, -Math.PI / 2 - WEDGE_HALF_RAD, -Math.PI / 2 + WEDGE_HALF_RAD)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(0, 0, DOT_PX, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = '#000000'
  ctx.stroke()
  ctx.restore()
}
