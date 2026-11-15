import type { Classified, SlopeLimit } from '../../domain'
import { ClassificationBadge } from '../../components/ClassificationBadge'
import { isCitedSlopeLimit, isOverLimit } from './slopeLimit'

/**
 * The planner's flag for a slope over its limit: a glyph and words
 * as well as the colour, and the limit's citation in its mark; a limit set in the mission settings says so in words and has no
 * OFFICIAL mark. Nothing while the slope is within the limit or unknown.
 */
export function SlopeLimitFlag({ slope, limit }: { slope: Classified<number>; limit: SlopeLimit }) {
  if (!isOverLimit(slope, limit)) return null
  return (
    <p data-over-limit="" className="flex items-center gap-1.5 text-caption text-danger">
      <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="currentColor" aria-hidden="true">
        <path d="M12 3 2 21h20L12 3zm-1 6h2v6h-2V9zm0 8h2v2h-2v-2z" />
      </svg>
      {`Over the ${limit.deg}° limit: ${limit.label}`}
      {isCitedSlopeLimit(limit) && <ClassificationBadge classification="OFFICIAL" detail={limit.source} />}
    </p>
  )
}
