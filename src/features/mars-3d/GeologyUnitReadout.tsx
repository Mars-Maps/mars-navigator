import { ClassificationBadge } from '../../components/ClassificationBadge'
import type { GeologicUnitArea } from '../../domain'
import { useMissionStore, useUnitHover } from '../../state'
import { unitText, unitUnder } from './geologyLabel'

/**
 * The geologic unit under the cursor, from `useUnitHover` (HoverPick,
 * finer than the coordinate tag's one decimal) and the shown areas, with
 * their source, while the geology layer is active. Shows nothing while the
 * cursor is off the globe; a point off the shown map says so, never a guessed
 * unit. The shell places it, as it does the coordinate readout.
 */
export function GeologyUnitReadout({ areas, source }: { areas: readonly GeologicUnitArea[]; source: string }) {
  const hover = useUnitHover((s) => s.at)
  const active = useMissionStore((s) => s.activeLayerId === 'geology')
  if (!active || hover === null || areas.length === 0) return null
  const unit = unitUnder(areas, hover, source)
  return (
    <p className="flex items-center gap-1.5 text-caption text-ink-muted">
      {unit.classification === 'UNAVAILABLE' ? `No ${areas[0].unit.map.id} unit here` : unitText(unit.value)}
      <ClassificationBadge
        classification={unit.classification}
        detail={
          unit.classification === 'UNAVAILABLE'
            ? unit.reason
            : unit.classification === 'DERIVED'
              ? unit.method
              : unit.source
        }
        passive
      />
    </p>
  )
}
