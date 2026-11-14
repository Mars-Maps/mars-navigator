import type { ComponentProps, RefObject } from 'react'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { cssColor, ROUTE_PIN_COLOR, TRAVERSE_COLOR } from '../pinColors'
import type { MapPin, MapPinKind, WalkOnMap } from './mapOverlay'

/**
 * The overhead map's caption: the imagery and its mark, the scale
 * and the pointer's coordinate (both DERIVED, written by the map through
 * the refs), the pins' legend, and how to use it. It scrolls rather than
 * push the panel off a short screen.
 */
export function MapCaption({
  width,
  expanded,
  layerLabel,
  hasImagery,
  spanRef,
  hoverRef,
  pins,
  line,
  walk,
  traverseSource = null,
}: {
  width: number
  expanded: boolean
  layerLabel: string
  hasImagery: boolean
  spanRef: RefObject<HTMLSpanElement | null>
  hoverRef: RefObject<HTMLSpanElement | null>
  pins: readonly MapPin[]
  line: boolean
  /** The planned walk the map draws. */
  walk: WalkOnMap
  /** Where the rover's path comes from, while it is drawn; null otherwise. */
  traverseSource?: string | null
}) {
  return (
    <div className="flex min-h-0 items-start gap-2 overflow-y-auto" style={{ maxWidth: width }}>
      <span className="shrink-0 pt-0.5">
        <ClassificationBadge classification={hasImagery ? 'OFFICIAL' : 'UNAVAILABLE'} />
      </span>
      <p>
        {hasImagery
          ? `${layerLabel}, north up, with the ground's own picture around you except near a pole.${expanded ? ' In its grid of degrees, so stretched east–west towards the poles.' : ''} Blurrier until finer tiles load; dark where the layer has no data.`
          : `${layerLabel} has not loaded, so there is no picture.`}
        {/* Its own line, so a longer readout never wraps and shifts the map under the pointer. */}
        <br />
        <span>
          About <span ref={spanRef}>—</span> km top to bottom
          <InlineBadge
            classification="DERIVED"
            detail="The window's height in degrees of latitude times the mean radius's km per degree."
          />
        </span>
        <br />
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          Pointer: <span ref={hoverRef} className="font-mono text-ink">—</span>
          <ClassificationBadge classification="DERIVED" detail="Read from the map grid, to about one screen pixel." />
        </span>
        {pins.length > 0 && <MapLegend pins={pins} line={line} />}
        {walk.stops.length > 0 && <WalkLegend walk={walk} />}
        {traverseSource !== null && (
          <>
            <br />
            <span>
              <span aria-hidden className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: cssColor(TRAVERSE_COLOR) }} />
              the solid line joins the rover's waypoints, straight between them
              <InlineBadge classification="OFFICIAL" detail={traverseSource} />
            </span>
          </>
        )}
        <br />
        {expanded
          ? 'Drag to move · wheel to zoom · click to teleport · right-click to see the coordinate first · Esc to collapse'
          : 'Drag · wheel · click to teleport · right-click to ask first'}
      </p>
    </div>
  )
}

/**
 * A mark after a sentence that may wrap: inline, so the sentence
 * wraps as text and the mark follows its last word, not a flex column.
 */
function InlineBadge(props: ComponentProps<typeof ClassificationBadge>) {
  return (
    <span className="ml-1 inline-block align-middle">
      <ClassificationBadge {...props} />
    </span>
  )
}

/** What the dashed line and white dots are: the plan's own lines, flagging and never going around anything. */
function WalkLegend({ walk }: { walk: WalkOnMap }) {
  return (
    <>
      <br />
      <span>
        <span aria-hidden className="mr-1 inline-block size-2 rounded-full align-middle" style={{ background: '#ffffff' }} />
        {walk.mark === null
          ? "the white dots are the walk's stops; no line between them was planned"
          : walk.mark.classification === 'SIMULATED'
            ? 'the white dots and dashed line are the sample walk, invented, not a plan'
            : 'the white dots and dashed line are the planned walk, straight between its stops, not routed around anything'}
        {walk.mark !== null && <InlineBadge classification={walk.mark.classification} detail={walk.mark.detail} />}
      </span>
    </>
  )
}

const PIN_LEGEND: Record<MapPinKind, string> = {
  departure: 'departure',
  stop: 'stop',
  destination: 'destination',
  marked: 'marked point',
}

/** The pin colours shown, and what the dotted line is: your waypoints in order, not a planned path. */
function MapLegend({ pins, line }: { pins: readonly MapPin[]; line: boolean }) {
  const kinds = (Object.keys(PIN_LEGEND) as MapPinKind[]).filter((k) => pins.some((p) => p.kind === k))
  return (
    <>
      <br />
      {kinds.map((k) => (
        <span key={k} className="mr-2 inline-flex items-center gap-1 whitespace-nowrap">
          <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: cssColor(ROUTE_PIN_COLOR[k]) }} />
          {PIN_LEGEND[k]}
        </span>
      ))}
      {line && <span>· the dotted line joins your waypoints in order; not a planned path</span>}
    </>
  )
}
