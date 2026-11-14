import { useEffect, useId, useRef, useState } from 'react'
import { isAvailable, type MarsCoordinate } from '../../../domain'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { Panel } from '../../../components/Panel'
import { formatDistanceM } from '../stops/stopCardMath'
import { bySol, countText, NO_PHOTOS_NEAR_STOPS, page, STRIP_PAGE, type PathPhoto } from './photoStripMath'
import { RoverPhotoThumb, type PhotoGoTo } from './RoverPhotoThumb'

/** The photos near one stop of the walk, as the stop card has them. */
export interface StopPhotos {
  label: string
  photos: readonly PathPhoto[]
  /** Why the stop's search gave no photos, when it did not look everywhere within the radius. */
  reason?: string
}

/**
 * Real rover photos along the path, so the astronaut can see what
 * the ground looks like before walking it: thumbnails in sol order, for the
 * whole path or near one stop, a page at a time. A click goes to where the
 * photo was taken (`onGoTo`, the host's "Center view"); a photo with no
 * known position says so instead, and one placed approximately says that.
 *
 * Props only, and nothing is fetched here, so the strip never holds up the
 * globe: thumbnails load lazily as they scroll into view. While the photos
 * are not there, `notReady` says why, so an empty strip is never read as
 * "no photos".
 */
export function PhotoStrip({
  photos,
  stops,
  radiusM,
  notReady,
  scope,
  onGoTo,
}: {
  /** Every photo the join placed along the path. */
  photos: readonly PathPhoto[]
  /** The walk's stops and the photos near each, in walking order. */
  stops: readonly StopPhotos[]
  /** How far from a stop the join looked, metres. */
  radiusM: number
  /** Shown instead of the photos while they load, or when they could not be read. */
  notReady?: string
  /** Which photos were looked for, shown under the title, so a count is never read as every photo there. */
  scope?: string
  onGoTo: (at: MarsCoordinate) => void
}) {
  // null: the whole path; otherwise the stop's index.
  const [stopIndex, setStopIndex] = useState<number | null>(null)
  const [count, setCount] = useState(STRIP_PAGE)
  const name = useId()
  const list = useRef<HTMLUListElement>(null)
  // The first photo a "Show more" added: focus goes there after the render,
  // so a keyboard user lands on the new photos rather than after them, and
  // focus never drops to the page when the last page removes the button.
  const firstNew = useRef<number | null>(null)
  useEffect(() => {
    if (firstNew.current === null) return
    list.current?.children[firstNew.current]?.querySelector('button')?.focus()
    firstNew.current = null
  }, [count])
  const stop = stopIndex !== null && stopIndex < stops.length ? stops[stopIndex] : null
  const ordered = bySol(stop ? stop.photos : photos)
  const { shown, remaining } = page(ordered, count)
  const choose = (index: number | null) => {
    setStopIndex(index)
    setCount(STRIP_PAGE)
    // A new list starts at its oldest photo, not at the old list's scroll.
    list.current?.scrollTo({ left: 0 })
  }
  const showMore = () => {
    firstNew.current = count
    setCount(count + STRIP_PAGE)
  }

  return (
    <Panel surface="glass" compact className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-body text-ink">
          Rover photos
          <ClassificationBadge
            classification="OFFICIAL"
            detail="NASA's raw images as published, each with its credit. Where each was taken is DERIVED by joining its site and drive to the rover's path; approximate where no exact match exists."
          />
        </h2>
        {notReady === undefined && ordered.length > 0 && (
          <p className="text-caption text-ink-subtle">{countText(shown.length, ordered.length)}</p>
        )}
      </div>
      {notReady === undefined && scope !== undefined && <p className="text-caption text-ink-subtle">{scope}</p>}

      {stops.length > 0 && (
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">Which photos</legend>
          <Choice name={name} label="All stops" checked={stop === null} onChoose={() => choose(null)} />
          {stops.map((s, i) => (
            <Choice key={s.label} name={name} label={`Near ${s.label}`} checked={stopIndex === i} onChoose={() => choose(i)} />
          ))}
        </fieldset>
      )}

      {notReady !== undefined ? (
        <p className="text-body text-ink-muted">{notReady}</p>
      ) : ordered.length === 0 ? (
        <p className="text-body text-ink-muted">{emptyText(stop, stops, radiusM)}</p>
      ) : (
        <ul ref={list} aria-label="Rover photos, oldest sol first" className="flex gap-2 overflow-x-auto pb-2">
          {shown.map((p) => (
            <li key={p.image.id} className="w-28 shrink-0">
              <RoverPhotoThumb image={p.image} goTo={goToFor(p, onGoTo)} className="w-full">
                {p.image.position.classification === 'UNAVAILABLE' ? (
                  <span className="inline-flex items-center gap-1 italic text-ink-muted">
                    Position unknown
                    <ClassificationBadge classification="UNAVAILABLE" detail={p.image.position.reason} />
                  </span>
                ) : (
                  p.approximate && <span className="italic text-ink-muted">Approximate position</span>
                )}
              </RoverPhotoThumb>
            </li>
          ))}
          {remaining > 0 && (
            <li className="flex w-28 shrink-0 items-center justify-center">
              <button
                type="button"
                onClick={showMore}
                className="rounded-control border border-line px-2 py-1 text-caption text-ink transition-colors duration-(--duration-fast) hover:bg-surface-raised"
              >
                {`Show ${Math.min(STRIP_PAGE, remaining)} more`}
              </button>
            </li>
          )}
        </ul>
      )}

      {notReady === undefined && stop === null && stops.some((s) => s.reason !== undefined) && (
        // All stops shows only what was found, so every stop that found none says why here, a failed read included.
        <ul aria-label="Stops with no photos" className="flex flex-col gap-0.5 text-caption text-ink-muted">
          {stops.map((s) => s.reason !== undefined && <li key={s.label}>{`${s.label}: ${s.reason}`}</li>)}
        </ul>
      )}
    </Panel>
  )
}

/**
 * What an empty list says. A stop's own reason wins over "none within", which
 * is only true when its search looked; with stops' reasons given, the All
 * stops view lists them below rather than claiming the path has none.
 */
function emptyText(stop: StopPhotos | null, stops: readonly StopPhotos[], radiusM: number): string {
  if (stop) return stop.reason ?? `No rover photos within ${formatDistanceM(radiusM)} of ${stop.label}`
  return stops.some((s) => s.reason !== undefined) ? NO_PHOTOS_NEAR_STOPS : 'No rover photos placed along this path'
}

function goToFor(p: PathPhoto, onGoTo: (at: MarsCoordinate) => void): PhotoGoTo {
  const at = p.image.position
  return isAvailable(at) ? { onGoTo: () => onGoTo(at.value) } : { unavailable: at.reason }
}

/** One option of the filter: a native radio, so arrow keys move between them, drawn as a chip as the route picker's are. */
function Choice({ name, label, checked, onChoose }: { name: string; label: string; checked: boolean; onChoose: () => void }) {
  return (
    <label
      className={`cursor-pointer rounded-control px-2 py-0.5 text-caption transition-colors duration-(--duration-fast) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-(--color-focus) ${
        checked ? 'bg-accent/15 text-ink' : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChoose} className="sr-only" />
      {label}
    </label>
  )
}
