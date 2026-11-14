import type { ReactNode } from 'react'
import {
  RADIATION_LEVEL_BASIS,
  RADIATION_LEVEL_TEXT,
  SHIELDING_WARNING_BASIS,
  SHIELDING_WARNING_TEXT,
  formatMarsCoordinate,
  isAvailable,
  radiationLevel,
  type Classified,
  type Hazard,
  type RadiationHazard,
  type RadiationLevel,
} from '../../../domain'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { ClassifiedValue } from '../ClassifiedValue'
import { formatShielding, radiationHazards, type RadiationReading } from './radiationMath'

/**
 * The radiation warning wherever the astronaut looks: the point
 * menu's Radiation field, a radiation hazard in the hazards panel or on the
 * stop card, and one glyph in the HUD. It is about the atmosphere overhead
 * against Gale: never "higher dose", never a number of mSv, and the
 * dose stays UNAVAILABLE with its reason. The words are the domain's
 * SHIELDING_WARNING_TEXT, shown as is. The same
 * fraction also reads as a level, LOW / MEDIUM / HIGH: HIGH
 * is the warning, so the two never disagree.
 */

/** The level word, HIGH in the danger colour; the others neutral, since neither is "safe". */
export function RadiationLevelWord({ level }: { level: RadiationLevel }) {
  return (
    <span
      data-radiation-level={level}
      className={`text-caption font-semibold tracking-wide ${level === 'HIGH' ? 'text-danger' : 'text-ink'}`}
    >
      {level}
    </span>
  )
}

/** The warning line: a glyph and words as well as the colour, as the slope flag has. */
export function RadiationWarningFlag({ text }: { text: string }) {
  return (
    <p data-radiation-warning="" className="flex items-start gap-1.5 text-caption text-danger">
      <WarningGlyph className="mt-px size-4 shrink-0" />
      {text}
    </p>
  )
}

/**
 * The point menu's Radiation field: the dose (UNAVAILABLE), with the Gale
 * measurement under it as a reference when the host has one, then
 * the atmosphere overhead with its level and the warning under the
 * threshold, with the threshold named as a project choice.
 * Divs, as the reference is a paragraph. No level is shown while the
 * shielding is unknown: the UNAVAILABLE fraction says why.
 */
export function RadiationField({ reading, doseReference }: { reading: RadiationReading; doseReference?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        <span className="text-caption text-ink-muted">Dose</span>
        <ClassifiedValue value={reading.dose} />
        {doseReference}
      </div>
      <div className="flex flex-col">
        <span className="text-caption text-ink-muted">Atmosphere overhead</span>
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          {reading.level && <RadiationLevelWord level={reading.level} />}
          <ClassifiedValue value={reading.shielding} format={formatShielding} />
        </span>
        {reading.level && (
          <span data-radiation-level-basis="" className="text-caption text-ink-subtle">
            {/* HIGH's own words follow as the warning; the other two say what they mean here. */}
            {reading.level === 'HIGH' ? RADIATION_LEVEL_BASIS : `${RADIATION_LEVEL_TEXT[reading.level]}. ${RADIATION_LEVEL_BASIS}`}
          </span>
        )}
      </div>
      {reading.warn && (
        <div className="flex flex-col gap-0.5">
          <RadiationWarningFlag text={SHIELDING_WARNING_TEXT} />
          <span data-radiation-basis="" className="text-caption text-ink-subtle">
            {SHIELDING_WARNING_BASIS}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * One radiation hazard on a leg: the rule's words, the leg's highest
 * point, where it was found, and the atmosphere overhead there. A hazard with
 * no figure is ground not checked, and says that instead.
 */
export function RadiationHazardNote({ hazard }: { hazard: RadiationHazard }) {
  // Ground with no height has no shielding figure: that is not a warning, and it has no highest point.
  if (hazard.magnitude.classification === 'UNAVAILABLE') {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1.5 text-caption">
        <span className="text-ink-muted">Radiation not checked</span>
        <ClassificationBadge classification="UNAVAILABLE" detail={hazard.magnitude.reason} />
        <span className="tabular-nums text-ink-subtle">{formatMarsCoordinate(hazard.coordinate, 3)}</span>
      </span>
    )
  }
  // A hazard with a figure is under the line by construction, so its level is HIGH; read, not assumed.
  const level = radiationLevel(hazard.magnitude.value)
  return (
    <span className="flex flex-col gap-0.5">
      <RadiationWarningFlag text={SHIELDING_WARNING_TEXT} />
      <span className="text-caption tabular-nums text-ink-subtle">
        {`Highest point ${formatMarsCoordinate(hazard.coordinate)}`}
      </span>
      <span className="inline-flex flex-wrap items-center gap-x-1.5 text-caption">
        <span className="text-ink-muted">Atmosphere overhead</span>
        {level && <RadiationLevelWord level={level} />}
        <ClassifiedValue value={hazard.magnitude} format={formatShielding} />
      </span>
    </span>
  )
}

/**
 * The HUD's one glyph: shown when the next leg carries a radiation
 * hazard with a figure; nothing otherwise, nothing for ground not checked, and
 * nothing while the leg is not yet scanned.
 * The words are in its name, for a screen reader and on hover.
 */
export function RadiationHudGlyph({ nextLegHazards }: { nextLegHazards: Classified<Hazard[]> }) {
  // A hazard with no figure is ground not checked, which is no warning.
  if (!radiationHazards(nextLegHazards).some((h) => isAvailable(h.magnitude))) return null
  const label = `Radiation HIGH on the next leg: ${SHIELDING_WARNING_TEXT.charAt(0).toLowerCase()}${SHIELDING_WARNING_TEXT.slice(1)}`
  return (
    <span role="img" aria-label={label} title={label} data-radiation-warning="" className="inline-flex text-danger">
      <WarningGlyph className="size-5" />
    </span>
  )
}

function WarningGlyph({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 3 2 21h20L12 3zm-1 6h2v6h-2V9zm0 8h2v2h-2v-2z" />
    </svg>
  )
}
