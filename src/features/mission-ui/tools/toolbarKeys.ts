/**
 * Arrow-key movement inside the tool dock, the ARIA toolbar pattern:
 * the dock is one Tab stop, ← and → move between tools and wrap, Home and
 * End jump to the ends. null for a key the toolbar does not handle.
 */
export function nextToolbarIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count
    case 'ArrowLeft':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
