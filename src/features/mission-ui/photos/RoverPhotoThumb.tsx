import { useState, type ReactNode } from 'react'
import type { SurfaceImage } from '../../../domain'
import { photoTitle } from '../stops/stopCardMath'

/**
 * Where a photo in the strip can take the view: a handler, or the
 * reason it cannot, when the photo has no known position.
 */
export type PhotoGoTo = { onGoTo: () => void } | { unavailable: string }

/**
 * One rover photo as a thumbnail. NASA's image as published,
 * loaded lazily, with its credit always under it ("thumbnails first, full
 * size on demand"). A thumbnail that fails to load says so, never an
 * empty frame that reads as a dark photo. `children` go in the caption
 * above the credit: the distance, "approximate position". The width is the
 * host's (`className`): a grid cell, or a fixed width in a strip.
 *
 * Without `goTo` the picture links to the full size in a new tab (the stop
 * card). With it (the photo strip) the picture is a button that goes to
 * where the photo was taken, and "Full size" is a link in the caption. With
 * no known position the button stays focusable and says why, rather than
 * being disabled where a keyboard user cannot reach the reason.
 */
export function RoverPhotoThumb({
  image,
  goTo,
  className = 'w-28',
  children,
}: {
  image: SurfaceImage
  goTo?: PhotoGoTo
  className?: string
  children?: ReactNode
}) {
  const [failed, setFailed] = useState(false)
  const title = photoTitle(image)
  const picture = failed ? (
    <span className="flex size-full items-center justify-center p-2 text-center text-micro text-ink-subtle">
      Thumbnail did not load
    </span>
  ) : (
    <img
      src={image.thumbnailUrl}
      alt={title}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="size-full object-cover"
    />
  )
  const frame = 'block aspect-square w-full overflow-hidden rounded-control border border-line bg-surface-raised'
  const fullSize = `${title}: open full size in a new tab`

  return (
    <figure className={`flex min-w-0 shrink-0 flex-col gap-1 ${className}`}>
      {goTo === undefined ? (
        <a href={image.fullUrl} target="_blank" rel="noreferrer" aria-label={fullSize} title={image.caption ?? title} className={frame}>
          {picture}
        </a>
      ) : 'onGoTo' in goTo ? (
        <button
          type="button"
          onClick={goTo.onGoTo}
          aria-label={`${title}: go to where it was taken`}
          title={image.caption ?? title}
          className={`${frame} transition-colors duration-(--duration-fast) hover:border-accent`}
        >
          {picture}
        </button>
      ) : (
        <button
          type="button"
          aria-disabled="true"
          aria-label={`${title}: position unknown, ${goTo.unavailable}`}
          title={`Position unknown: ${goTo.unavailable}`}
          className={`${frame} cursor-not-allowed`}
        >
          {picture}
        </button>
      )}
      <figcaption className="flex flex-col gap-0.5 text-micro text-ink-subtle">
        <span className="text-ink-muted">{`Sol ${image.sol}`}</span>
        <span className="truncate" title={image.camera}>
          {image.camera}
        </span>
        {children}
        {goTo !== undefined && (
          <a href={image.fullUrl} target="_blank" rel="noreferrer" aria-label={fullSize} className="text-ink-muted underline hover:text-ink">
            Full size
          </a>
        )}
        <span>{`Credit: ${image.credit}`}</span>
      </figcaption>
    </figure>
  )
}
