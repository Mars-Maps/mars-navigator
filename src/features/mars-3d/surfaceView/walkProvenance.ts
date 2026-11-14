import type { DataClassification, WalkLeg } from '../../../domain'

/** What the walk rows say about the plan's line, taken from its legs. */
export interface WalkProvenance {
  classification: DataClassification
  /** Where the line comes from, as the legs state it: the method or the source. */
  from: string
  /** How many legs have no path, so are not drawn and not walked. */
  unrouted: number
}

/**
 * The classification and source of the planned line, from the
 * legs' own `path` classifications rather than assumed: SIMULATED if any
 * leg is (an invented line is never shown as derived),
 * UNAVAILABLE when no leg has a path, otherwise DERIVED or OFFICIAL with
 * the legs' methods or sources, each named once.
 */
export function walkProvenance(legs: readonly WalkLeg[]): WalkProvenance {
  const paths = legs.map((l) => l.path)
  const unrouted = paths.filter((p) => p.classification === 'UNAVAILABLE').length
  const named = (kind: DataClassification) => [
    ...new Set(
      paths.flatMap((p) =>
        p.classification !== kind
          ? []
          : p.classification === 'DERIVED'
            ? [p.method]
            : p.classification === 'UNAVAILABLE'
              ? [p.reason]
              : [p.source],
      ),
    ),
  ]
  for (const kind of ['SIMULATED', 'DERIVED', 'OFFICIAL'] as const) {
    const from = named(kind)
    if (from.length > 0) return { classification: kind, from: from.join('; '), unrouted }
  }
  return { classification: 'UNAVAILABLE', from: named('UNAVAILABLE').join('; ') || 'the plan has no legs', unrouted }
}

/** The words for a walk under way or a jump; `line` is the plan's own class, so an invented line says so. */
export function walkNoticeText(
  walk: { kind: 'walking'; stopLabel: string; movedToStart: boolean } | { kind: 'jumped'; stopLabel: string },
  line: DataClassification,
  speedMS: number,
): string {
  if (walk.kind === 'jumped') return `No planned path to ${walk.stopLabel}: moved there directly, not walked.`
  const along = line === 'SIMULATED' ? 'invented test line' : 'planned route'
  const moved = walk.movedToStart ? ' You were off the route, so you were moved onto its start, not walked there.' : ''
  return `Walking to ${walk.stopLabel} along the ${along} at ${speedMS} m/s, sped up for the rehearsal: not a walking time. Any move key stops.${moved}`
}
