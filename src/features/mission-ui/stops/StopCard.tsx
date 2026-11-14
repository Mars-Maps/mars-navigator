import type { ReactNode } from 'react'
import { isAvailable, unavailable, type Classified, type GeologicUnit, type Hazard, type SlopeLimit } from '../../../domain'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import { useEscapeLayer } from '../../../lib/useEscapeLayer'
import { ClassifiedValue } from '../ClassifiedValue'
import { RoverPhotoThumb } from '../photos/RoverPhotoThumb'
import { READING_ELEVATION_REASON } from '../pointFields'
import { READING_SLOPE_REASON } from '../pointFields'
import { HazardRow } from '../walk/LegDetail'
import { SlopeLimitFlag } from '../SlopeLimitFlag'
import { formatSlope, legSlopeToFlag, shownSlope } from '../slopeLimit'
import {
  formatDistanceM,
  formatElevation,
  noPhotosText,
  PHOTOS_NOT_READ_REASON,
  photosToShow,
  shownDistance,
  shownElevation,
} from './stopCardMath'
import type { PhotoNearby } from '../../route-analysis/photoPositions'

/**
 * What is at one stop of the planned walk: the rock unit and why the
 * science goal leads here, the ground, and real rover photos taken nearby,
 * so the astronaut knows what to expect before reaching it.
 *
 * Every figure keeps its mark: the unit and its text are the map's own
 * (OFFICIAL, its citation in the mark), the reason is the goal's reviewed
 * unit table, the height and slope at the stop are the shell's
 * reads of the elevation chain, and
 * each photo's distance is the photo join's. Photos are NASA's,
 * each with its credit; with none near, the card says how far it looked.
 * The leg into the stop has its own section: its steepest slope with the
 * limit's flag, and every flag the planner put on it (mapped obstacles,
 * radiation) in the walk panel's words. The first stop has no leg, so
 * no section. Photos that were never read say so, never "none found".
 *
 * Props only, so the host decides where it shows; `stopPlanFacts` gives
 * the plan's part of them. With `onClose` it is a window: a
 * × in its title bar, and Esc closes it.
 */
export function StopCard({
  label,
  unit,
  reason,
  elevationM,
  slopeDeg,
  slopeLimit,
  fromPreviousKm,
  legSteepestSlopeDeg,
  legHazards,
  photos,
  photosUnavailableReason = PHOTOS_NOT_READ_REASON,
  photoRadiusM,
  onClose,
}: {
  /** As the planner names the stop, e.g. "Stop 2". */
  label: string
  /** The unit the stop stands on, OFFICIAL with its map, or UNAVAILABLE where no map covers it. */
  unit: Classified<GeologicUnit>
  /**
   * Why the science goal leads here, quoted from the unit's description;
   * null for a route waypoint the user chose, whose card has no
   * such row rather than one saying it does not apply.
   */
  reason: Classified<string> | null
  /**
   * Metres above the MOLA areoid at the stop, from the shell's elevation
   * read (`elevation.elevationAt`); null while it is being read, shown as
   * UNAVAILABLE with the point menu's words, never a blank.
   */
  elevationM: Classified<number> | null
  /**
   * The ground's slope at the stop, degrees: the shell's slope read
   * (`readSlope`), DERIVED from the heights around it; null while
   * it is being read, shown as UNAVAILABLE with the point menu's words.
   */
  slopeDeg: Classified<number> | null
  slopeLimit: SlopeLimit
  /** Distance from the previous stop, km; null at the first stop. */
  fromPreviousKm: Classified<number> | null
  /** The steepest stretch of the leg into the stop, degrees, as the planner measured it; null at the first stop. */
  legSteepestSlopeDeg: Classified<number> | null
  /** The planner's hazards on the leg into the stop; null at the first stop. */
  legHazards: Classified<Hazard[]> | null
  /** Rover photos the join found near the stop; null where no search ran, which is not "none found". */
  photos: readonly PhotoNearby[] | null
  /**
   * Why no search ran, when `photos` is null: by default the photos were
   * not read; `PHOTOS_NOT_PLACED_REASON` when they were but the rover's
   * path was not, so none could be placed.
   */
  photosUnavailableReason?: string
  /** How far from the stop the join looked for photos, metres. */
  photoRadiusM: number
  onClose?: () => void
}) {
  const { minimized, toggle, bodyId } = useMinimized()
  useEscapeLayer(onClose !== undefined, () => onClose?.())
  const elevation = shownElevation(elevationM ?? unavailable<number>(READING_ELEVATION_REASON))
  const fromPrevious = fromPreviousKm === null ? null : shownDistance(fromPreviousKm)
  const slope = shownSlope(slopeDeg ?? unavailable(READING_SLOPE_REASON))
  const { shown, more } = photosToShow(photos ?? [], photoRadiusM)

  return (
    <Panel surface="glass" compact className="flex w-96 max-w-full flex-col">
      <PanelHeader title={label} minimized={minimized} onToggleMinimized={toggle} bodyId={bodyId} onClose={onClose} spacing="mb-3">
        <h2 className="truncate text-body text-ink">{label}</h2>
      </PanelHeader>
      {!minimized && (
        <div id={bodyId} className="flex flex-col gap-3 text-body text-ink-muted">
          <Section title="Rock unit">
            <ClassifiedValue value={unit} format={(u) => `${u.name} (${u.symbol})`} />
            {unit.classification !== 'UNAVAILABLE' && (unit.value.description || unit.value.interpretation) && (
              <details className="text-caption">
                <summary className="cursor-pointer text-ink-subtle hover:text-ink">The map’s description</summary>
                {unit.value.description && <p className="mt-1">{unit.value.description}</p>}
                {unit.value.interpretation && <p className="mt-1">{`Interpretation: ${unit.value.interpretation}`}</p>}
              </details>
            )}
          </Section>

          {reason !== null && (
            <Section title="Why stop here">
              {/* As the planner wrote it: its reason quotes the map itself where it has a quote. */}
              <ClassifiedValue value={reason} />
            </Section>
          )}

          <Section title="Ground">
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Field name="Elevation">
                <ClassifiedValue value={elevation} format={formatElevation} />
              </Field>
              <Field name="Slope">
                <ClassifiedValue value={slope} format={formatSlope} />
              </Field>
            </span>
            {/* Straight under the slope it is about: after the distance, at 384 px it read as the distance's flag. */}
            <SlopeLimitFlag slope={slope} limit={slopeLimit} />
            <Field name={fromPrevious === null ? 'First stop' : 'From the previous stop'}>
              {fromPrevious !== null && <ClassifiedValue value={fromPrevious} format={(km) => formatDistanceM(km * 1000)} />}
            </Field>
          </Section>

          {legSteepestSlopeDeg !== null && legHazards !== null && (
            <LegIn slopeDeg={legSteepestSlopeDeg} hazards={legHazards} slopeLimit={slopeLimit} />
          )}

          <Section
            title="Rover photos nearby"
            // The mark vouches for photos, so with none on screen there is nothing for it to mark.
            mark={
              shown.length > 0 && (
                <ClassificationBadge
                  classification="OFFICIAL"
                  detail="NASA's raw images as published, each with its credit. Where each was taken is DERIVED by joining its site and drive to the rover's path; each distance's mark says how."
                />
              )
            }
          >
            {photos === null ? (
              <ClassifiedValue value={unavailable(photosUnavailableReason)} />
            ) : shown.length === 0 ? (
              <p>{noPhotosText(photoRadiusM)}</p>
            ) : (
              <>
                <ul className="grid grid-cols-3 gap-2">
                  {shown.map((p) => (
                    <li key={p.image.id} className="min-w-0">
                      <RoverPhotoThumb image={p.image} className="w-full">
                        <ClassifiedValue value={p.distanceM} format={(m) => `${formatDistanceM(m)} away`} />
                        {p.approximate && <span className="italic text-ink-muted">Approximate position</span>}
                      </RoverPhotoThumb>
                    </li>
                  ))}
                </ul>
                {more > 0 && <p className="text-caption">{`${more} more within ${formatDistanceM(photoRadiusM)}`}</p>}
              </>
            )}
          </Section>
        </div>
      )}
    </Panel>
  )
}

/**
 * The leg into the stop: its steepest slope, flagged over the limit by the
 * same rule as the HUD, then the planner's other flags. A measured slope flag
 * would repeat the slope row, so it is left out; a stretch the planner could
 * not check stays, as "Slope not checked", since the slope row shows nothing
 * for it and the leg must never read as checked. The flag also reads the leg's
 * measured stretches, so a leg with ground left unchecked still shows one
 * it knows is over (`legSlopeToFlag`). A list the planner could not make
 * shows as unavailable, never as clear.
 */
function LegIn({ slopeDeg, hazards, slopeLimit }: { slopeDeg: Classified<number>; hazards: Classified<Hazard[]>; slopeLimit: SlopeLimit }) {
  const slope = shownSlope(slopeDeg)
  const flags = isAvailable(hazards) ? hazards.value.filter((h) => h.kind !== 'slope' || !isAvailable(h.magnitude)) : []
  return (
    <Section title="On the way here">
      <Field name="Steepest slope">
        <ClassifiedValue value={slope} format={formatSlope} />
      </Field>
      <SlopeLimitFlag slope={legSlopeToFlag(slopeDeg, hazards)} limit={slopeLimit} />
      {!isAvailable(hazards) && (
        <Field name="Flags">
          <ClassifiedValue value={hazards} />
        </Field>
      )}
      {/* Silence would read differently from the walk panel's same leg: say what was checked, never "safe". */}
      {isAvailable(hazards) && flags.length === 0 && (
        <Field name={hazards.value.length === 0 ? 'None flagged' : 'No other flags'}>
          <ClassificationBadge
            classification={hazards.classification}
            detail={hazards.classification === 'DERIVED' ? hazards.method : hazards.source}
          />
        </Field>
      )}
      {flags.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-caption">
          {flags.map((h) => (
            <li key={h.id}>
              <HazardRow hazard={h} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Section({ title, mark, children }: { title: string; mark?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="flex items-center gap-1.5 text-caption text-ink-subtle">
        {title}
        {mark}
      </h3>
      {children}
    </section>
  )
}

function Field({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {name}
      {children}
    </span>
  )
}
