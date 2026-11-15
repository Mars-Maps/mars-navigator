import {
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
import { SCANNED_HAZARD_KINDS, UNSCANNED_HAZARD_KINDS } from '../../route-analysis/hazards'
import { ROUTE_SLOPE_MEASURE, SLOPE_WARNING_BASIS, slopeWarning } from '../../route-analysis/slopeHazard'
import { keptOffBySearch } from '../../route-analysis/strategies/searchedRoute'
import { RadiationHazardNote } from '../radiation/RadiationWarning'
import { HAZARD_LABEL, listKinds } from './labels'

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
      {list && !minimized && (
        <ul id={bodyId} className="mt-2 flex flex-col gap-2">
          {list.map((hazard) => (
            <li key={hazard.id} className="text-body">
              <HazardEntry hazard={hazard} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/**
 * One hazard in two short lines: what it is with its figure, and where.
 * Radiation says the atmosphere overhead rather than a bare magnitude; a
 * steep slope says in a word when it is over the suited limit as well.
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
  const { magnitude } = hazard
  const over = hazard.kind === 'slope' && isAvailable(magnitude) && slopeWarning(magnitude.value) === 'over-limit'
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-1.5">
        {hazard.kind === 'slope' && (
          <WarningGlyph className="size-4 shrink-0 text-danger" />
        )}
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
  // The kinds come from the detector table, not from this result: the
  // detectors that are built all read the route's heights, so a DERIVED list
  // means they ran. The scan's own words are in the methodology.
  return <p className="text-body text-ink-muted">{capitalise(listKinds(SCANNED_HAZARD_KINDS))}: none found</p>
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Everything the panel no longer spells out, one click away: how this
 * route was scanned (the scan's own method, or why it could not run), the
 * kinds nothing scans for, what the route search kept off the path (what the
 * search did, not a scan: those kinds still read "not scanned"), and what a
 * steep slope and a radiation warning mean. A route that was not searched,
 * or a map not read, has nothing kept off.
 */
export function HazardsMethodology({ route }: { route: RouteOption }) {
  const { hazards } = route
  const kept: Partial<Record<HazardKind, string>> = keptOffBySearch(route)
  const keptKinds = (Object.keys(kept) as HazardKind[]).filter((k) => kept[k] !== undefined)
  return (
    <Methodology title="How the hazards were scanned">
      {hazards.classification === 'UNAVAILABLE' ? (
        <MethodologyItem heading="Not yet scanned">{hazards.reason}.</MethodologyItem>
      ) : (
        <>
          <MethodologyItem heading="Steep slope: how it is measured">{ROUTE_SLOPE_MEASURE}.</MethodologyItem>
          <MethodologyItem heading="Steep slope: when it warns">{SLOPE_WARNING_BASIS}.</MethodologyItem>
          <MethodologyItem heading="Radiation: how it is measured">
            At each point of the path with a height, the atmosphere overhead as a fraction of the atmosphere over Gale
            crater, from the point&rsquo;s elevation. It is a shielding level, never a dose.
          </MethodologyItem>
          <MethodologyItem heading="Radiation: when it warns">
            {SHIELDING_WARNING_TEXT}. {SHIELDING_WARNING_BASIS}.
          </MethodologyItem>
        </>
      )}
      {UNSCANNED_HAZARD_KINDS.length > 0 && (
        <MethodologyItem heading="Not scanned for">
          {capitalise(listKinds(UNSCANNED_HAZARD_KINDS))}: no detector is built for these yet, so the panel never
          says there are none.
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
