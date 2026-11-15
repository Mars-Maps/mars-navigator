import {
  SHIELDING_METHOD,
  SHIELDING_WARNING_BASIS,
  SHIELDING_WARNING_TEXT,
  SUITED_SLOPE_LIMIT,
  formatMarsCoordinate,
  isAvailable,
  type Hazard,
  type HazardKind,
  type RouteOption,
} from '../../../domain'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { Methodology, MethodologyItem } from '../../../components/Methodology'
import { Panel } from '../../../components/Panel'
import { WarningGlyph } from '../../../components/WarningGlyph'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import { ClassifiedValue } from '../ClassifiedValue'
import { HAZARD_DETECTORS } from '../../route-analysis/hazards'
import { ROUTE_SLOPE_MEASURE, SLOPE_WARNING_BASIS, slopeWarning } from '../../route-analysis/slopeHazard'
import { keptOffBySearch } from '../../route-analysis/strategies/searchedRoute'
import { RadiationHazardNote } from '../radiation/RadiationWarning'
import { HazardRow } from '../walk/LegDetail'
import { HAZARD_LABEL, listKinds } from './labels'

const ALL_HAZARD_KINDS = Object.keys(HAZARD_DETECTORS) as HazardKind[]

/** The kinds scanned over part of this route only, each with what was left out. */
function partlyScanned(route: RouteOption): Partial<Record<HazardKind, string>> {
  return route.hazardsPartlyScanned ?? {}
}

/** "Mapped obstacle checked on part of the route only", for the kinds that were; null with none. */
function partlyLine(route: RouteOption): string | null {
  const partly = partlyScanned(route)
  const kinds = ALL_HAZARD_KINDS.filter((k) => partly[k] !== undefined)
  return kinds.length === 0 ? null : `${listKinds(kinds)} checked on part of the route only`
}

/**
 * One decimal place until the dataset says what precision its magnitudes
 * carry; printing the raw float would claim precision nobody measured. An
 * empty unit is shown as unknown rather than as a bare number.
 */
const formatMagnitude = (magnitude: number, unit: string) =>
  unit === '°' ? `${magnitude.toFixed(1)}°` : `${magnitude.toFixed(1)} ${unit || 'unit unknown'}`

/**
 * Hazards along the route. Four states, kept apart on purpose:
 *
 *   no route     — nothing to scan
 *   UNAVAILABLE  — "not yet scanned", never "no hazards"
 *   []           — scanned and none found; the only state that may say so,
 *                  and it names the kinds scanned for
 *   a list       — one short row per hazard
 *
 * The panel stays short: a state is one line, a hazard two. How
 * the route was scanned, what was not scanned for, what the route search
 * kept off and what each warning means are behind the Methodology button.
 * One thing is not: a kind checked on part of the route only is said on
 * show, in a few words, so "none found" and a list never read as the whole
 * route. Which part was left out, and why, is in the methodology.
 */
export function HazardsPanel({ route }: { route: RouteOption | null }) {
  const hazards = route?.hazards
  // A scanned route with hazards lists them below; every other state is one line.
  const list =
    hazards && hazards.classification !== 'UNAVAILABLE' && hazards.value.length > 0
      ? hazards.value
      : null
  const { minimized, toggle, bodyId } = useMinimized()
  return (
    <Panel surface="glass" compact>
      {/* A one-line state sits on the heading's line, so the panel stays
          short in the navigation column. Minimised, the bar keeps what the
          state is: the count of a list, or the UNAVAILABLE mark of a route
          not yet scanned. */}
      <PanelHeader title="Hazards" minimized={minimized} onToggleMinimized={toggle} bodyId={bodyId}>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <h2 className="text-body font-semibold text-ink">Hazards</h2>
          {list && <span className="text-body text-ink-subtle">· {list.length}</span>}
          {/* The scan is derived, and its own method (the kinds scanned, the kinds not, and why) is its mark. */}
          {hazards?.classification === 'DERIVED' && <ClassificationBadge classification="DERIVED" detail={hazards.method} />}
          {hazards?.classification === 'UNAVAILABLE' && minimized && (
            <ClassificationBadge classification="UNAVAILABLE" detail={hazards.reason} />
          )}
          {/* With no list the one-line state is the body, so it carries the
              id here, on the bar's line, and folds with the rest. */}
          {!list && !minimized && (
            <div id={bodyId} className="contents">
              <span aria-hidden="true" className="text-ink-subtle">
                ·
              </span>
              <HazardsState route={route} />
            </div>
          )}
          {route && !minimized && <HazardsMethodology route={route} />}
        </div>
      </PanelHeader>
      {list && route && !minimized && (
        <div id={bodyId} className="mt-2 flex flex-col gap-2">
          <ul className="flex flex-col gap-2">
            {list.map((hazard) => (
              <li key={hazard.id} className="text-body">
                <HazardEntry hazard={hazard} />
              </li>
            ))}
          </ul>
          {/* The rows are only what was found where the scan looked: a kind it looked for on part of
              the route, or could not look for on this route at all, is said under them. The reason is in the methodology. */}
          {partlyLine(route) && <p className="text-caption text-ink-subtle">{capitalise(partlyLine(route)!)}</p>}
          {ownReason(route.hazards, 'mapped-obstacle') !== null && (
            <p className="text-caption text-ink-subtle">{HAZARD_LABEL['mapped-obstacle']} not scanned</p>
          )}
        </div>
      )}
    </Panel>
  )
}

/**
 * One hazard in two short lines: what it is with its figure, and where.
 * Radiation says the atmosphere overhead rather than a bare magnitude; a
 * mapped obstacle what the map marks there; a steep slope says in a word
 * when it is over the suited limit as well.
 */
function HazardEntry({ hazard }: { hazard: Hazard }) {
  if (hazard.kind === 'radiation') {
    return (
      <>
        <p className="font-medium text-ink">{HAZARD_LABEL[hazard.kind]}</p>
        <RadiationHazardNote hazard={hazard} />
      </>
    )
  }
  if (hazard.kind === 'mapped-obstacle') {
    // The map gives no size, so the row names what it marks, as a walk leg's flag does.
    return (
      <>
        <p className="font-medium text-ink">{HAZARD_LABEL[hazard.kind]}</p>
        <div className="text-caption">
          <HazardRow hazard={hazard} />
        </div>
      </>
    )
  }
  const { magnitude } = hazard
  const over = hazard.kind === 'slope' && isAvailable(magnitude) && slopeWarning(magnitude.value) === 'over-limit'
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-1.5">
        {/* The project's steep band in its own colour, as the point menu has it; red only over the cited limit. */}
        {hazard.kind === 'slope' && <WarningGlyph className={`size-4 shrink-0 ${over ? 'text-danger' : 'text-slope-steep'}`} />}
        <span className="font-medium text-ink">{HAZARD_LABEL[hazard.kind]}</span>
        <ClassifiedValue value={magnitude} format={(m) => formatMagnitude(m, hazard.unit)} />
        {over && (
          <span data-over-limit="" className="text-caption text-danger">
            over {SUITED_SLOPE_LIMIT.deg}°
          </span>
        )}
      </p>
      <p className="text-caption tabular-nums text-ink-subtle">{formatMarsCoordinate(hazard.coordinate)}</p>
    </>
  )
}

/**
 * The three states with no list: no route, not yet scanned, scanned and none
 * found. The last names the kinds scanned for, since the scan is partial:
 * "none found" of steep slope and radiation is not "no hazards".
 */
function HazardsState({ route }: { route: RouteOption | null }) {
  if (!route) {
    return <p className="text-body text-ink-muted">No route planned</p>
  }
  if (route.hazards.classification === 'UNAVAILABLE') {
    return (
      <p className="flex items-center gap-1.5 text-body text-ink-muted">
        Not yet scanned
        <ClassificationBadge classification="UNAVAILABLE" detail={route.hazards.reason} />
      </p>
    )
  }
  // Only the kinds this scan ran over the whole route: a detector that could not run on it, or
  // ran on part of it, is not "none found". The part is said beside it, in its own words.
  const kinds = ALL_HAZARD_KINDS.filter((k) => scannedFor(route, k))
  const partly = partlyLine(route)
  const none = kinds.length > 0 ? `${capitalise(listKinds(kinds))}: none found` : null
  return (
    <p className="text-body text-ink-muted">
      {none}
      {none && partly ? ' · ' : null}
      {partly && (none ? partly : capitalise(partly))}
      {/* A scan that names no kind in the words read here: said as that, never left blank or as "none found". */}
      {!none && !partly && 'Scanned: what for is in the methodology'}
    </p>
  )
}

/**
 * Whether this scan ran the detector of `kind` over the whole route. A
 * route that carries its own coverage says it (a searched route: a kind
 * scanned in part is not in it); for any other it is read from the scan's
 * own method (`detectHazards` names each kind it scanned, then those it did not).
 */
function scannedFor(route: RouteOption, kind: HazardKind): boolean {
  const { hazards } = route
  if (hazards.classification !== 'DERIVED') return false
  if (route.hazardsScanned) return route.hazardsScanned.includes(kind)
  const [ran] = hazards.method.split('. Not scanned: ')
  return ran.startsWith(`Scanned for ${kind}: `) || ran.includes(`; ${kind}: `)
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Why this scan did not run the detector of `kind`, in the scan's own words. */
function notScannedReason(hazards: RouteOption['hazards'], kind: HazardKind): string {
  return ownReason(hazards, kind) ?? 'This scan could not run it on this route'
}

/** The reason this scan gives for not running the detector of `kind`, or null where it names none. */
function ownReason(hazards: RouteOption['hazards'], kind: HazardKind): string | null {
  const fallback = null
  if (hazards.classification !== 'DERIVED') return fallback
  // "kind (reason); kind (reason)": a reason may hold "; " and brackets itself, so an entry
  // ends where the next kind's entry starts, or at the end, not at the first "; ".
  const notScanned = hazards.method.split('. Not scanned: ')[1] ?? ''
  const starts = (Object.keys(HAZARD_LABEL) as HazardKind[])
    .map((k) => ({ kind: k, at: notScanned.startsWith(`${k} (`) ? 0 : notScanned.indexOf(`); ${k} (`) }))
    .filter((entry) => entry.at !== -1)
    .map((entry) => ({ kind: entry.kind, at: entry.at === 0 ? 0 : entry.at + 3 }))
    .sort((a, b) => a.at - b.at)
  const n = starts.findIndex((entry) => entry.kind === kind)
  if (n === -1) return fallback
  const end = n + 1 < starts.length ? starts[n + 1].at - 2 : notScanned.length
  return notScanned.slice(starts[n].at + kind.length + 2, end - 1)
}

/**
 * Everything the panel no longer spells out, one click away: how this
 * route was scanned, kind by kind (how it is measured and when it warns, or
 * why this scan could not run it, or which part of the route it left out),
 * the kinds nothing looks for, what the route search kept off the path (what
 * the search did, which is not a scan of the path), and what a steep slope
 * and a radiation warning mean. A route that was not searched, or a map not
 * read, has nothing kept off.
 */
export function HazardsMethodology({ route }: { route: RouteOption }) {
  const { hazards } = route
  const kept: Partial<Record<HazardKind, string>> = keptOffBySearch(route)
  const keptKinds = (Object.keys(kept) as HazardKind[]).filter((k) => kept[k] !== undefined)
  const partly = partlyScanned(route)
  // What the map marks: scanned on this route, on part of it, not scanned for a reason this scan gives, or not at all.
  const mapReason = ownReason(hazards, 'mapped-obstacle')
  const mapSaid = scannedFor(route, 'mapped-obstacle') || partly['mapped-obstacle'] !== undefined || mapReason !== null
  // The kinds nothing looked for on this route; slope, radiation and a mapped obstacle that has its own entry are said above.
  const said: readonly HazardKind[] = mapSaid ? ['slope', 'radiation', 'mapped-obstacle'] : ['slope', 'radiation']
  const notLookedFor = ALL_HAZARD_KINDS.filter((k) => !said.includes(k) && !scannedFor(route, k) && partly[k] === undefined)
  return (
    <Methodology title="How the hazards were scanned">
      {hazards.classification === 'UNAVAILABLE' ? (
        <MethodologyItem heading="Not yet scanned">{hazards.reason}.</MethodologyItem>
      ) : (
        <>
          {scannedFor(route, 'slope') ? (
            <>
              <MethodologyItem heading="Steep slope: how it is measured">{ROUTE_SLOPE_MEASURE}.</MethodologyItem>
              <MethodologyItem heading="Steep slope: when it warns">{SLOPE_WARNING_BASIS}.</MethodologyItem>
            </>
          ) : (
            <MethodologyItem heading="Steep slope: not scanned on this route">{notScannedReason(hazards, 'slope')}.</MethodologyItem>
          )}
          {scannedFor(route, 'radiation') ? (
            <>
              <MethodologyItem heading="Radiation: how it is measured">
                At each point of the path with a height, the atmosphere overhead as a fraction of the atmosphere over
                Gale crater, from the point&rsquo;s elevation. It is a shielding level, never a dose.
              </MethodologyItem>
              <MethodologyItem heading="Radiation: when it warns">
                {SHIELDING_WARNING_TEXT}. {SHIELDING_WARNING_BASIS}.
              </MethodologyItem>
              <MethodologyItem heading="Radiation: calculation">{SHIELDING_METHOD}.</MethodologyItem>
            </>
          ) : (
            <MethodologyItem heading="Radiation: not scanned on this route">{notScannedReason(hazards, 'radiation')}.</MethodologyItem>
          )}
          {scannedFor(route, 'mapped-obstacle') ? (
            <MethodologyItem heading="Mapped obstacle: how it is found">
              What the geologic map marks along the path, from the map features the route search read for each leg.
              What is looked for, and how near, is in the mark beside the heading.
            </MethodologyItem>
          ) : partly['mapped-obstacle'] !== undefined ? (
            <MethodologyItem heading="Mapped obstacle: checked on part of the route only">
              {partly['mapped-obstacle']}. Where it was checked, what the geologic map marks along the path is listed;
              none found there is not none on the route.
            </MethodologyItem>
          ) : mapReason !== null ? (
            <MethodologyItem heading="Mapped obstacle: not scanned on this route">{mapReason}.</MethodologyItem>
          ) : null}
        </>
      )}
      {notLookedFor.length > 0 && (
        <MethodologyItem heading="Not scanned for">
          {capitalise(listKinds(notLookedFor))}: nothing looks for these on this route, so the panel never says
          there are none.
        </MethodologyItem>
      )}
      {keptKinds.length > 0 && (
        <MethodologyItem heading="Kept off by the route search">
          {keptKinds.map((k) => (
            <span key={k} className="block">
              {kept[k]}.
            </span>
          ))}
          <span className="block">That is what the search avoided, not a scan of the path.</span>
        </MethodologyItem>
      )}
      <MethodologyItem heading="Each figure">
        The exact calculation and its sources are in the mark beside each figure.
      </MethodologyItem>
    </Methodology>
  )
}
