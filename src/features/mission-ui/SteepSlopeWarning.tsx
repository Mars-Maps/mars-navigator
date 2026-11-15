import { isAvailable, type Classified } from '../../domain'
import { Methodology, MethodologyItem } from '../../components/Methodology'
import { WarningGlyph } from '../../components/WarningGlyph'
import { SLOPE_WARNING_BASIS, SLOPE_WARNING_TEXT, slopeWarning } from '../route-analysis/slopeHazard'

/**
 * The steep slope warning under a slope figure: a glyph and a few
 * words as well as the colour, and the two lines' sources behind the
 * Methodology button. Over the cited suited limit it is in the danger
 * colour; merely steep, the project's own band, in the caution colour.
 * Nothing for gentler ground, and nothing while the slope is unknown: no
 * warning is guessed.
 */
export function SteepSlopeWarning({ slope }: { slope: Classified<number> }) {
  const warning = isAvailable(slope) ? slopeWarning(slope.value) : null
  if (warning === null) return null
  return (
    <span
      data-slope-warning={warning}
      className={`flex flex-wrap items-center gap-1.5 text-caption ${warning === 'over-limit' ? 'text-danger' : 'text-slope-steep'}`}
    >
      <WarningGlyph className="size-4 shrink-0" />
      {SLOPE_WARNING_TEXT[warning]}
      <SlopeWarningMethodology />
    </span>
  )
}

/** What the two steep slope lines are and where each comes from. */
export function SlopeWarningMethodology() {
  return (
    <Methodology title="Steep slope warning">
      <MethodologyItem heading="The two lines">{SLOPE_WARNING_BASIS}.</MethodologyItem>
      <MethodologyItem heading="The figure">
        How the slope itself was measured, and over how much ground, is in the mark beside the figure.
      </MethodologyItem>
    </Methodology>
  )
}
