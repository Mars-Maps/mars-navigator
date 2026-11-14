import type { ReactNode } from 'react'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { HAZARD_NOT_CHECKED, formatMarsCoordinate, isAvailable, type Classified, type Hazard, type WalkLeg } from '../../../domain'
import { describeProvenGround } from '../../route-analysis/provenGround'
import { ClassifiedValue } from '../ClassifiedValue'
import { HAZARD_LABEL } from '../navigation/labels'
import { RadiationHazardNote } from '../radiation/RadiationWarning'

const formatDeg = (deg: number) => `${deg.toFixed(1)}°`

/**
 * What the plan says of one leg before anyone walks it: its steepest
 * slope and everything flagged on it, each figure and reason the planner's
 * own. An empty list says "none flagged" and never "safe": the planner only
 * checks the slope limit and what the map marks. A slope or map not checked
 * is its own row, so it never reads as clear. The distance from the rover's
 * path is a distance too, never a claim about the ground.
 */
export function LegDetail({ leg, limitDeg }: { leg: WalkLeg; limitDeg: number }) {
  const steepest = leg.steepestSlopeDeg
  const over = isAvailable(steepest) && steepest.value > limitDeg
  return (
    <div className="flex flex-col gap-0.5 text-caption text-ink-muted">
      <p className="flex flex-wrap items-center gap-1.5">
        <span>Steepest slope</span>
        <ClassifiedValue value={steepest} format={formatDeg} />
        {over && <span className="text-danger">over {limitDeg}°</span>}
      </p>
      <LegHazards hazards={leg.hazards} />
      {leg.farthestFromRoverPathM && <RoverPathRow distance={leg.farthestFromRoverPathM} />}
    </div>
  )
}

function RoverPathRow({ distance }: { distance: Classified<number> }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5">
      <span>{isAvailable(distance) ? 'Whole leg' : 'Distance from the rover path'}</span>
      <ClassifiedValue value={distance} format={(m) => describeProvenGround(m)} />
    </p>
  )
}

function LegHazards({ hazards }: { hazards: WalkLeg['hazards'] }) {
  if (!isAvailable(hazards)) {
    return (
      <p className="flex flex-wrap items-center gap-1.5">
        <span>Flags</span>
        <ClassifiedValue value={hazards} />
      </p>
    )
  }
  const provenance = hazards.classification === 'DERIVED' ? hazards.method : hazards.source
  return (
    <>
      <p className="flex flex-wrap items-center gap-1.5">
        <span>{hazards.value.length === 0 ? 'None flagged' : 'Flags'}</span>
        <ClassificationBadge classification={hazards.classification} detail={provenance} />
      </p>
      {hazards.value.length > 0 && (
        <ul className="flex flex-col gap-0.5 pl-2">
          {hazards.value.map((hazard) => (
            <li key={hazard.id}>
              <HazardRow hazard={hazard} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** One flag on a leg, in the planner's words; the stop card shows its leg-in's the same way. */
export function HazardRow({ hazard }: { hazard: Hazard }) {
  if (hazard.kind === 'radiation') return <RadiationHazardNote hazard={hazard} />
  const place = <span className="tabular-nums text-ink-subtle">{formatMarsCoordinate(hazard.coordinate, 3)}</span>
  const { magnitude } = hazard
  if (hazard.kind === 'mapped-obstacle') {
    if (hazard.unit === HAZARD_NOT_CHECKED) return <Row label="Mapped obstacles not checked" hazard={hazard} />
    return <Row label={`On the map: ${hazard.unit}`} hazard={hazard} place={place} />
  }
  if (!isAvailable(magnitude)) {
    const label = hazard.kind === 'slope' ? 'Slope not checked' : `${HAZARD_LABEL[hazard.kind]}: not known`
    return <Row label={label} hazard={hazard} />
  }
  return (
    <p className="flex flex-wrap items-center gap-1.5">
      <span className="text-ink">{HAZARD_LABEL[hazard.kind]}</span>
      <ClassifiedValue value={magnitude} format={hazard.kind === 'slope' ? formatDeg : (m) => `${m.toFixed(1)} ${hazard.unit}`} />
      {place}
    </p>
  )
}

/** A flag with no figure: the words, and the reason in the mark. */
function Row({ label, hazard, place }: { label: string; hazard: Hazard; place?: ReactNode }) {
  const { magnitude } = hazard
  const detail = isAvailable(magnitude)
    ? magnitude.classification === 'DERIVED'
      ? magnitude.method
      : magnitude.source
    : magnitude.reason
  return (
    <p className="flex flex-wrap items-center gap-1.5">
      <span className="text-ink">{label}</span>
      <ClassificationBadge classification={magnitude.classification} detail={detail} />
      {place}
    </p>
  )
}
