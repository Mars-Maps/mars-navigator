import { ClassificationBadge } from '../../../components/ClassificationBadge'
import type { WalkStatus } from './WalkDriver'
import { walkNoticeText, type WalkProvenance } from './walkProvenance'

/**
 * What the walk is doing, where it is seen: the pace is sped up and a
 * jump is not a walk, and the surface panel's rows can scroll out of sight.
 */
export function WalkNotice({ walk, line, speedMS }: { walk: WalkStatus; line: WalkProvenance | null; speedMS: number }) {
  if (walk === null) return null
  const classification = walk.kind === 'jumped' || line === null ? 'UNAVAILABLE' : line.classification
  return (
    <div
      role="status"
      className="pointer-events-none absolute bottom-8 left-1/2 flex w-max max-w-md -translate-x-1/2 items-start gap-2 rounded-control border border-line/60 bg-surface/80 px-3 py-2 text-caption text-ink backdrop-blur-glass"
    >
      <ClassificationBadge classification={classification} detail={line?.from} passive />
      <span>{walkNoticeText(walk, line?.classification ?? 'UNAVAILABLE', speedMS)}</span>
    </div>
  )
}
