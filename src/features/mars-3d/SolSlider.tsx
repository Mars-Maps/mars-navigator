import { useId } from 'react'
import { ClassificationBadge } from '../../components/ClassificationBadge'

/**
 * Shows the rover's path up to a sol. The sol is always printed
 * beside the slider, so its position is never the only signal. The range
 * is the feed's own first and last sol; nothing past the last is offered.
 */
export function SolSlider({
  first,
  last,
  value,
  roverName,
  source,
  onChange,
}: {
  first: number
  last: number
  value: number
  roverName: string
  /** The feed the sols come from, for the mark's tooltip. */
  source: string
  onChange: (sol: number) => void
}) {
  const id = useId()
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-panel border border-line/60 bg-surface/70 px-3 py-2 text-caption text-ink-muted shadow-panel backdrop-blur-glass">
      <label htmlFor={id} className="whitespace-nowrap">
        {roverName} path to sol <span className="font-mono text-ink">{value}</span>
      </label>
      <input
        id={id}
        type="range"
        min={first}
        max={last}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-56 accent-ink"
      />
      <ClassificationBadge classification="OFFICIAL" detail={source} />
    </div>
  )
}
