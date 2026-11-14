/**
 * The page `delta` steps away from `index` among `count` pages, wrapping at
 * both ends, so the point menu's arrows never stop at an edge.
 */
export function stepPage(index: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return (((index + delta) % count) + count) % count
}
