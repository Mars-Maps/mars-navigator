import { ClassificationBadge } from '../components/ClassificationBadge'

/**
 * Says, while the `?sampleWalk` plan is the plan, that it is invented; Clear
 * removes it.
 */
export function SampleWalkBanner({
  active,
  text,
  onClear,
}: {
  active: boolean
  text: string
  onClear: () => void
}) {
  if (!active) return null
  return (
    <div
      role="status"
      className="pointer-events-auto absolute left-1/2 top-4 flex max-w-sm -translate-x-1/2 items-center gap-2 rounded-control border border-simulated/40 bg-surface/80 px-3 py-1.5 text-caption text-simulated backdrop-blur-glass"
    >
      <ClassificationBadge classification="SIMULATED" detail="Invented to test the walk flow" />
      <span>{text}</span>
      <button
        type="button"
        onClick={onClear}
        className="rounded-control border border-line px-2 py-0.5 text-ink transition-colors duration-(--duration-fast) hover:bg-surface-raised"
      >
        Clear
      </button>
    </div>
  )
}
