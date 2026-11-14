/**
 * "34° above the horizon", "2° below the horizon" or "on the horizon", to
 * the whole degree. Shared by the HUD and the surface view's sky
 * caption, so the two never word the same angle differently.
 */
export function describeSunElevation(deg: number): string {
  const whole = Math.round(deg)
  // Math.round(-0.4) is -0, which is on the horizon too.
  if (whole === 0) return 'on the horizon'
  return whole > 0 ? `${whole}° above the horizon` : `${-whole}° below the horizon`
}
