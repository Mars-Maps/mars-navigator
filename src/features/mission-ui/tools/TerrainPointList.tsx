import type { MarsCoordinate } from '../../../domain'
import { formatMarsCoordinate } from '../../../domain'

/**
 * The points a profile tool has taken, one row each: its name
 * (A and B, or 1 to 4), its coordinate, and a pencil that makes the next
 * click on the globe move that point (pressed while it waits; the same
 * pencil again cancels). Under the list, Clear drops every point and puts
 * the tool away. Renders from props; the shell wires the store.
 */
export function TerrainPointList({
  points,
  names,
  replacing,
  onReplace,
  onClear,
  label,
}: {
  points: readonly MarsCoordinate[]
  /** The name of the point at this index: "A", or "1". */
  names: (index: number) => string
  /** The index whose next click moves it, or null. */
  replacing: number | null
  onReplace: (index: number) => void
  onClear: () => void
  /** The list's accessible name: "Points" or "Corners". */
  label: string
}) {
  if (points.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <ol aria-label={label} className="flex flex-col gap-1">
        {points.map((c, i) => (
          <li key={`${i}:${c.latitude}:${c.longitudeEast}`} className="flex items-center gap-2 text-body">
            <span className="w-4 shrink-0 text-caption font-semibold tabular-nums text-accent">{names(i)}</span>
            <span className="min-w-0 flex-1 tabular-nums text-ink">{formatMarsCoordinate(c, 2)}</span>
            <button
              type="button"
              aria-label={`Change point ${names(i)}`}
              aria-pressed={replacing === i}
              title={replacing === i ? 'Click the surface to move it' : 'Change: the next click moves this point'}
              onClick={() => onReplace(i)}
              className="shrink-0 rounded-control p-1 text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink focus-visible:bg-surface-raised focus-visible:text-ink aria-pressed:bg-accent/20 aria-pressed:text-accent"
            >
              <PencilIcon />
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={onClear}
        className="self-start rounded-control border border-line px-2 py-1 text-caption text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink focus-visible:bg-surface-raised focus-visible:text-ink"
      >
        Clear
      </button>
    </div>
  )
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}
