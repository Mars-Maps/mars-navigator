import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { Methodology, MethodologyItem } from '../../../components/Methodology'
import { LANDING_LEGEND } from '../../route-analysis/landingFavourability'
import { CRATER_INTERIOR_LEGEND } from '../../route-analysis/landingLattice'

/** Where the landing colours on the map are: being read, drawn (with how they were worked out), or why not. */
export type LandingColoursStatus = { status: 'loading' } | { status: 'failed'; reason: string } | { status: 'ready'; method: string }

const ROWS = [
  { dot: 'bg-slope-gentle', name: 'Green', rule: LANDING_LEGEND.green },
  { dot: 'bg-slope-moderate', name: 'Yellow', rule: LANDING_LEGEND.yellow },
  { dot: 'bg-slope-steep', name: 'Red', rule: LANDING_LEGEND.red },
] as const

/**
 * What stays on show of the legend when the panel is minimised with the
 * colours still on the map: what they are and what they are not.
 */
export function LandingLegendLine({ method }: { method: string }) {
  return (
    <p className="flex items-start gap-1.5 text-caption text-ink-muted">
      <span>Landing colours: a project rating, not a statement that a landing is safe.</span>
      <ClassificationBadge classification="DERIVED" detail={`${LANDING_LEGEND.note} ${method}`} />
    </p>
  )
}

/**
 * The legend of the landing colours on the map, in the step that
 * shows them: each colour with its rule. What has no colour, what counts
 * as inside the crater, and that the colours are a project rating, not a
 * statement that a landing is safe, are behind the Methodology button.
 * The rules and the note are the rating's own text (`LANDING_LEGEND`), so
 * the legend cannot drift from what was computed. While the colours are
 * being read, or could not be, it says so and shows no swatches.
 */
export function LandingLegend({ colours }: { colours: LandingColoursStatus }) {
  if (colours.status === 'loading') {
    return (
      <p role="status" className="text-caption text-ink-muted">
        Reading the heights and the geologic map for the landing colours…
      </p>
    )
  }
  if (colours.status === 'failed') {
    return (
      <p role="status" className="flex items-start gap-1.5 text-caption text-ink-muted">
        <span>
          Landing colours: <span className="text-ink-subtle italic">unavailable</span>
        </span>
        <ClassificationBadge classification="UNAVAILABLE" detail={colours.reason} />
      </p>
    )
  }
  return (
    <section aria-label="Landing colours on the map" className="flex flex-col gap-1 border-t border-line/60 pt-2">
      <p className="flex flex-wrap items-center gap-1.5 text-caption text-ink-subtle">
        <span>Landing colours on the map</span>
        {/* The colours are derived: the mark carries the calculation, the button the plain words. */}
        <ClassificationBadge classification="DERIVED" detail={colours.method} />
        <Methodology title="How the landing colours are worked out">
          <MethodologyItem heading="What they are">{LANDING_LEGEND.note}</MethodologyItem>
          <MethodologyItem heading="Inside the crater">{CRATER_INTERIOR_LEGEND}</MethodologyItem>
          <MethodologyItem heading="No colour">{LANDING_LEGEND.unavailable}.</MethodologyItem>
          <MethodologyItem heading="Calculation">{colours.method}.</MethodologyItem>
        </Methodology>
      </p>
      <ul className="flex flex-col gap-0.5">
        {ROWS.map((row) => (
          <li key={row.name} className="flex items-start gap-1.5 text-caption text-ink-muted">
            <span aria-hidden="true" className={`mt-1 size-2.5 shrink-0 rounded-full ${row.dot}`} />
            <span>
              <span className="text-ink">{row.name}</span>: {row.rule}
            </span>
          </li>
        ))}
        <li className="flex items-start gap-1.5 text-caption text-ink-muted">
          <span aria-hidden="true" className="mt-1 size-2.5 shrink-0 rounded-full border border-line-strong" />
          <span>
            <span className="text-ink">No colour</span>: not rated
          </span>
        </li>
      </ul>
    </section>
  )
}
