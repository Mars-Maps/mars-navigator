import { isAvailable, type Classified } from '../../domain'
import { ClassificationBadge } from '../../components/ClassificationBadge'
import { useMissionStore, useSurfaceHeading } from '../../state'
import { compassHeading, compassShown, headingText, normalizeHeading } from './compassMath'

/** The dial's element id, which the icon panel's compass toggle controls. */
export const COMPASS_DIAL_ID = 'compass-dial'

/**
 * The compass slot's content: the dial while the icon panel's compass
 * button is on, nothing while it is off, so the slot stays empty. On the
 * surface the dial is always shown and follows the walker.
 *
 * Over the globe a click on the dial turns the view so north is up,
 * once: the view stays where it is until the user turns it. On the surface
 * the dial only shows the walker's heading, as before.
 */
export function Compass() {
  const shown = useMissionStore((s) => compassShown(s.viewMode, s.openSidePanels.compass))
  const surface = useMissionStore((s) => s.viewMode === 'surface')
  const requestNorthUp = useMissionStore((s) => s.requestNorthUp)
  const walker = useSurfaceHeading((s) => s.heading)
  const heading = useMissionStore((s) => compassHeading(s.viewMode, s.camera, walker))
  if (!shown) return null
  return <CompassDial heading={heading} onTurnNorthUp={surface ? undefined : requestNorthUp} />
}

/**
 * Which way north points on screen, as a dial and nothing else.
 * `heading` is degrees clockwise from screen-up to north at the view
 * centre; other finite values are wrapped into [0, 360).
 *
 * The needle is drawn only for an available, finite heading. The globe
 * carries Mars's axial tilt and the camera keeps screen-up fixed, so north
 * is often not up: an UNAVAILABLE heading gets the empty dial, never a
 * needle at a default angle. The words — the heading and its method, or the
 * reason there is none — are the dial's tooltip and accessible name, and
 * the mark's tooltip, so the dial carries no text of its own.
 *
 * With `onTurnNorthUp` and a heading, the dial is a button. Without
 * a heading there is no north to turn to, so it stays a picture.
 */
export function CompassDial({
  heading,
  onTurnNorthUp,
}: {
  heading: Classified<number>
  onTurnNorthUp?: () => void
}) {
  const h = isAvailable(heading) ? normalizeHeading(heading.value) : null
  const words = !isAvailable(heading)
    ? `Heading unavailable: ${heading.reason}`
    : h === null
      ? 'Heading unavailable: the heading is not a finite number'
      : `${headingText(h)}. ${heading.classification === 'DERIVED' ? heading.method : heading.source}`
  const turnable = onTurnNorthUp !== undefined && h !== null

  return (
    <div
      id={COMPASS_DIAL_ID}
      className="relative rounded-full border border-line/60 bg-surface/70 p-1 shadow-panel backdrop-blur-glass"
    >
      {turnable ? (
        <button
          type="button"
          onClick={onTurnNorthUp}
          className="block cursor-pointer rounded-full transition-colors duration-(--duration-fast) hover:bg-surface-raised"
        >
          <Dial heading={h} words={`${TURN_NORTH_UP}. ${words}`} />
        </button>
      ) : (
        <Dial heading={h} words={words} />
      )}
      <span className="absolute -bottom-1 -right-1">
        <ClassificationBadge
          classification={h === null ? 'UNAVAILABLE' : heading.classification}
          detail={words}
        />
      </span>
    </div>
  )
}

const R = 44

/** The dial's name while a click turns the view. */
export const TURN_NORTH_UP = 'Turn north up'

/** The dial outline, and the needle only when there is a heading. */
function Dial({ heading, words }: { heading: number | null; words: string }) {
  return (
    <svg viewBox="-50 -50 100 100" className="size-14 text-ink" role="img">
      <title>{`Compass. ${words}`}</title>
      <circle r={R} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
      {heading !== null && (
        <g data-needle="" transform={`rotate(${heading})`}>
          <path d="M 0,-30 L 7,0 L -7,0 Z" className="fill-accent" />
          <path d="M 0,30 L 7,0 L -7,0 Z" className="fill-ink-subtle" />
          {/* At the north tip, turned back so the letter stays upright. */}
          <text
            transform={`translate(0 -37) rotate(${-heading})`}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-accent text-[14px] font-semibold"
          >
            N
          </text>
        </g>
      )}
    </svg>
  )
}
