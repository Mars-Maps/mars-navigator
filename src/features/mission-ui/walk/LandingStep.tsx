import { formatMarsCoordinate, isAvailable, type Classified, type MarsCoordinate } from '../../../domain'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { LandingLegend, type LandingColoursStatus } from './LandingLegend'

/** How favourable the ground at the landing site is, as the panel words it: the colour and the slope it was judged on. */
export interface LandingReading {
  colour: 'green' | 'yellow' | 'red'
  slopeDeg: number
}

const COLOUR_WORD: Record<LandingReading['colour'], string> = { green: 'Green', yellow: 'Yellow', red: 'Red' }
// The slope bands' hues: apart from the classification hues, and the word beside the dot names the colour.
const COLOUR_DOT: Record<LandingReading['colour'], string> = {
  green: 'bg-slope-gentle',
  yellow: 'bg-slope-moderate',
  red: 'bg-slope-steep',
}

/**
 * Step 1 of Plan a walk: the landing site, set by a click on the
 * map. Renders from props. The shell runs the pick, which stays on while
 * this step is open so a second click moves the site, and says what is
 * wrong with a site no walk can start from.
 */
export function LandingStep({
  landing,
  problem,
  rating,
  colours,
  picking,
  onPick,
  onCancelPick,
  onUseSelected,
  onNext,
}: {
  landing: MarsCoordinate | null
  /** Why no walk can start from this site (outside the map sheet), or null. */
  problem: string | null
  /** The site's landing rating. Absent where nobody worked one out, so the row is left out rather than guessed. */
  rating?: Classified<LandingReading>
  /** The landing colours on the map and their legend. Absent where no colours are drawn. */
  colours?: LandingColoursStatus
  /** The next click on the map sets the site. */
  picking: boolean
  /** Turns the pick on. Absent where the route and its picks are fixed (navigation). */
  onPick?: () => void
  /** Turns the pick off, as Escape does. */
  onCancelPick: () => void
  /** Lands at the selected point: the way in without a pointer, since a point typed in the search bar is selected. Absent with no other point selected. */
  onUseSelected?: () => void
  onNext: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {landing ? (
        <p className="text-caption text-ink-muted">
          Landing site: <span className="tabular-nums text-ink">{formatMarsCoordinate(landing, 3)}</span>
        </p>
      ) : (
        <p className="text-caption text-ink-muted">No landing site yet.</p>
      )}
      {landing && rating && <RatingRow rating={rating} />}
      {problem && (
        <p role="alert" className="text-caption text-danger">
          {problem}
        </p>
      )}
      {/* Not a live region: the search bar's notice announces the pick. */}
      {picking && (
        <p className="text-caption text-accent">
          {landing ? 'Click the map again to move it.' : 'Click the map to set the landing site.'}
        </p>
      )}
      {onPick ? (
        // Stays mounted through the pick, so a keyboard press keeps its focus.
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={picking}
            onClick={picking ? onCancelPick : onPick}
            className={`rounded-control border px-3 py-1 text-body transition-colors duration-(--duration-fast) ${
              picking ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line text-ink hover:bg-surface-raised'
            }`}
          >
            {landing ? 'Change' : 'Pick the landing site on the map'}
          </button>
          {onUseSelected && (
            <button
              type="button"
              onClick={onUseSelected}
              className="rounded-control border border-line px-3 py-1 text-body text-ink transition-colors duration-(--duration-fast) hover:bg-surface-raised"
            >
              Use the selected point
            </button>
          )}
        </div>
      ) : (
        <p className="text-caption text-ink-muted">End navigation to pick the landing site on the globe.</p>
      )}
      <button
        type="button"
        disabled={landing === null || problem !== null}
        onClick={onNext}
        className="w-full rounded-control border border-accent/50 bg-accent/15 px-3 py-2 text-body font-medium text-accent transition-colors duration-(--duration-fast) hover:border-accent/80 hover:bg-accent/25 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:font-normal disabled:text-ink-subtle/60"
      >
        Next
      </button>
      {colours && <LandingLegend colours={colours} />}
    </div>
  )
}

function RatingRow({ rating }: { rating: Classified<LandingReading> }) {
  if (!isAvailable(rating)) {
    return (
      <p className="flex items-center gap-1.5 text-caption text-ink-muted">
        <span>
          Landing rating: <span className="text-ink-subtle italic">unavailable</span>
        </span>
        <ClassificationBadge classification={rating.classification} detail={rating.reason} />
      </p>
    )
  }
  const { colour, slopeDeg } = rating.value
  return (
    <p className="flex items-center gap-1.5 text-caption text-ink-muted">
      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${COLOUR_DOT[colour]}`} />
      <span>
        Landing rating: <span className="text-ink">{COLOUR_WORD[colour]}</span>, slope{' '}
        <span className="tabular-nums text-ink">{slopeDeg.toFixed(1)}°</span>
      </span>
      <ClassificationBadge
        classification={rating.classification}
        detail={rating.classification === 'DERIVED' ? rating.method : rating.source}
      />
    </p>
  )
}
