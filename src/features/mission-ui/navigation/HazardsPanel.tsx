import { Fragment } from 'react'
import { formatMarsCoordinate, type HazardKind, type RouteOption } from '../../../domain'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import { ClassifiedValue } from '../ClassifiedValue'
import { HAZARD_DETECTORS, SCANNED_HAZARD_KINDS } from '../../route-analysis/hazards'
import { keptOffBySearch } from '../../route-analysis/strategies/searchedRoute'
import { RadiationHazardNote } from '../radiation/RadiationWarning'
import { HazardRow } from '../walk/LegDetail'
import { HAZARD_LABEL, listKinds } from './labels'

const ALL_HAZARD_KINDS = Object.keys(HAZARD_DETECTORS) as HazardKind[]

/**
 * The kinds scanned on this route, and the rest. A route that carries its
 * own coverage says it (a searched route's mapped obstacles are scanned only
 * where the geologic map was read); any other is the detector table's.
 */
function scannedKinds(route: RouteOption): readonly HazardKind[] {
  return route.hazardsScanned ?? SCANNED_HAZARD_KINDS
}
function unscannedKinds(route: RouteOption): readonly HazardKind[] {
  const scanned = scannedKinds(route)
  return ALL_HAZARD_KINDS.filter((k) => !scanned.includes(k))
}

/**
 * One decimal place until the dataset says what precision its magnitudes
 * carry; printing the raw float would claim precision nobody measured. An
 * empty unit is shown as unknown rather than as a bare number.
 */
const formatMagnitude = (magnitude: number, unit: string) =>
  `${magnitude.toFixed(1)} ${unit || 'unit unknown'}`

/**
 * Hazards along the route. Four states, kept apart on purpose:
 *
 *   no route     — nothing to scan
 *   UNAVAILABLE  — "not yet scanned", never "no hazards"
 *   []           — scanned and none found; the only state that may say so,
 *                  and it names what was scanned for and what was not
 *   a list       — one row per hazard
 */
export function HazardsPanel({ route }: { route: RouteOption | null }) {
  const hazards = route?.hazards
  // A scanned route with hazards lists them below; every other state is one line.
  const list =
    hazards && hazards.classification !== 'UNAVAILABLE' && hazards.value.length > 0
      ? hazards.value
      : null
  // Scanned and none found: the one state whose line is a full sentence.
  const scanned = !list && hazards !== undefined && hazards.classification !== 'UNAVAILABLE'
  const { minimized, toggle, bodyId } = useMinimized()
  return (
    <Panel surface="glass" compact>
      {/* The scan's provenance beside the heading, outside it so the heading's
          name stays "Hazards". A one-line state sits on the heading's
          line too, so the panel stays short in the navigation column.
          Minimised, the bar keeps what the state is: the count of a
          list, or the UNAVAILABLE mark of a route not yet scanned. */}
      <PanelHeader title="Hazards" minimized={minimized} onToggleMinimized={toggle} bodyId={bodyId}>
        <div className="flex flex-wrap items-center gap-x-1.5">
          <h2 className="text-body font-semibold text-ink">Hazards</h2>
          {hazards && hazards.classification !== 'UNAVAILABLE' && (
            <ClassificationBadge
              classification={hazards.classification}
              detail={hazards.classification === 'DERIVED' ? hazards.method : hazards.source}
            />
          )}
          {list && minimized && <span className="text-body text-ink-subtle">· {list.length}</span>}
          {hazards?.classification === 'UNAVAILABLE' && minimized && (
            <ClassificationBadge classification="UNAVAILABLE" detail={hazards.reason} />
          )}
          {/* With no list the one-line state is the body, so it carries the
              id here, on the bar's line, and folds with the rest. The
              separator is only for a state that shares the heading's line:
              the scanned state is a sentence on its own line. */}
          {!list && !minimized && (
            <div id={bodyId} className="contents">
              {!scanned && (
                <span aria-hidden="true" className="text-ink-subtle">
                  ·
                </span>
              )}
              <HazardsState route={route} />
            </div>
          )}
        </div>
      </PanelHeader>
      {list && route && !minimized && (
        <div id={bodyId} className="mt-2 flex flex-col gap-2">
          <ul className="flex flex-col gap-2">
            {list.map((hazard) => (
              <li key={hazard.id} className="text-body">
                <p className="font-medium text-ink">{HAZARD_LABEL[hazard.kind]}</p>
                {/* Radiation says it in the shielding rule's words, with the
                    atmosphere overhead rather than a bare magnitude. */}
                {hazard.kind === 'radiation' ? (
                  <RadiationHazardNote hazard={hazard} />
                ) : hazard.kind === 'mapped-obstacle' ? (
                  // The map gives no size, so the row names what it marks, as a walk leg's flag does.
                  <div className="text-caption">
                    <HazardRow hazard={hazard} />
                  </div>
                ) : (
                  <>
                    <p className="text-caption tabular-nums text-ink-subtle">
                      {formatMarsCoordinate(hazard.coordinate)}
                    </p>
                    <ClassifiedValue
                      value={hazard.magnitude}
                      format={(m) => formatMagnitude(m, hazard.unit)}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
          {/* The rows are only what was scanned: the kinds that were not, and
              what the search kept off, follow them as in the one-line state. */}
          <p className="text-caption text-ink-subtle">
            <Coverage route={route} leading={false} />
          </p>
        </div>
      )}
    </Panel>
  )
}

/**
 * The three states with no list: no route, not yet scanned, scanned and none
 * found. The last names the kinds scanned for, since the scan is partial:
 * "none found" of radiation is not "no hazards".
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
  // The kinds are the route's own coverage when it carries one (a searched
  // route), else the detector table's: a DERIVED list means at least one
  // ready detector ran.
  // The sentence always takes its own line under the heading, at any panel
  // width, so the heading's line never ends in a separator.
  return (
    <p className="basis-full text-body text-ink-muted">
      Scanned for {listKinds(scannedKinds(route))}: none found
      <span className="text-caption text-ink-subtle">
        <Coverage route={route} leading />
      </span>
    </p>
  )
}

/**
 * The kinds not scanned, and apart from them those the route search
 * kept off the path: a searched route does not walk steps over 20° or
 * across mapped lines. That is what the search did, not a scan, so those
 * kinds still say "not scanned", and the badge gives the search's own words
 * (`keptOffBySearch`, the sentences its path method is built from). A route
 * that was not searched, or a map not read, keeps the kind in the plain list.
 */
function Coverage({ route, leading }: { route: RouteOption; leading: boolean }) {
  const kept: Partial<Record<HazardKind, string>> = keptOffBySearch(route)
  const unscanned = unscannedKinds(route)
  const keptKinds = unscanned.filter((k) => kept[k] !== undefined)
  const rest = unscanned.filter((k) => kept[k] === undefined)
  const parts: { text: string; detail?: string }[] = []
  if (rest.length > 0) parts.push({ text: `not scanned for ${listKinds(rest)}` })
  if (keptKinds.length > 0) {
    parts.push({
      text: `${listKinds(keptKinds)} kept off by the route search,`,
      detail: keptKinds.map((k) => `${kept[k]}.`).join(' '),
    })
  }
  return parts.map(({ text, detail }, i) => (
    <Fragment key={text}>
      {i > 0 || leading ? ' · ' : null}
      {/* Under a list the line starts a sentence; on the state line it follows one. */}
      {i === 0 && !leading ? text.charAt(0).toUpperCase() + text.slice(1) : text}
      {/* The mark keeps to its last words, so it never wraps onto a line alone. */}
      {detail && (
        <>
          {' '}
          <span className="whitespace-nowrap">
            not scanned <ClassificationBadge classification="DERIVED" detail={detail} />
          </span>
        </>
      )}
    </Fragment>
  ))
}
