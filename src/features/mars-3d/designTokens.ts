/**
 * A colour token from the design tokens in `src/index.css`, read from
 * :root where Tailwind emits them, so the scene's outlines follow the
 * palette. `fallback` is the token's value today, used where there
 * is no document (unit tests) or the token is missing.
 */
export function tokenColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** The darkest surface token: the outline that keeps route marks readable on any layer. */
export const OUTLINE_TOKEN = '--color-canvas'
export const OUTLINE_FALLBACK = '#0b0c0e'
