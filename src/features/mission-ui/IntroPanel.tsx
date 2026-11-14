import { BASE_MAP_LAYER_ID, type Classified, type MapLayer, type MissionSite } from '../../domain'
import { ClassificationBadge } from '../../components/ClassificationBadge'
import { Panel } from '../../components/Panel'
import { useMissionStore, useSite } from '../../state'
import { ClassifiedValue } from './ClassifiedValue'

/**
 * One reference figure. Matches the shape of MARS_CONSTANTS in src/data,
 * which features cannot import — the app shell passes the values in.
 */
export interface IntroConstant {
  label: string
  unit: string
  value: Classified<number>
  /** Caveat stated by the source, shown under the value. */
  note?: string
}

/**
 * Welcome-mode introduction, laid out as an intro view:
 * a large title and a line on the canvas, then a card with a small
 * picture of Mars and the reference figures the shell passes, in its order.
 * The slot shows it only in welcome mode, so the first click or zoom hides
 * it and the welcome screen's return (a zoom-out to the whole globe, then
 * ten idle seconds) brings it back; closing it sets `introDismissed`,
 * which the store clears on the next return. Scrolling this panel is not a
 * zoom and keeps it open.
 *
 * Values are shown exactly as given, with their source — never rounded.
 */
export function IntroPanel({
  constants,
}: {
  constants: Readonly<Record<string, IntroConstant>>
}) {
  const dismissed = useMissionStore((s) => s.introDismissed)
  const dismissIntro = useMissionStore((s) => s.dismissIntro)
  const picture = useMissionStore((s) => s.layers.find((l) => l.id === BASE_MAP_LAYER_ID) ?? null)
  const site = useSite((s) => s.site)
  const ellipse = useSite((s) => s.ellipse)
  const goToSite = useSite((s) => s.goToSite)
  if (dismissed) return null
  return (
    <IntroPanelView
      constants={constants}
      picture={picture}
      site={site}
      ellipseReason={ellipse?.classification === 'UNAVAILABLE' ? ellipse.reason : null}
      onStart={goToSite}
      onClose={dismissIntro}
    />
  )
}

/** Renders from props, so a test covers every state without the store. */
export function IntroPanelView({
  constants,
  picture,
  site = null,
  ellipseReason = null,
  onStart,
  onClose,
}: {
  constants: Readonly<Record<string, IntroConstant>>
  /** The layer whose preview tile is the card's picture; null until the catalogue arrives. */
  picture: MapLayer | null
  /** The site the app opens on; null until the shell sets it. */
  site?: MissionSite | null
  /** Why the landing ellipse is not on the globe, or null while it is read or shown. */
  ellipseReason?: string | null
  /** Flies to the site (the store's `goToSite`). */
  onStart?: () => void
  onClose: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* On the canvas, not a panel, by design. */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-display font-normal text-ink">Mars</h1>
          {site && (
            <p className="mt-1 text-body text-ink" title={site.source}>
              {site.name} · the Mars 2020 landing site. {site.mission}
            </p>
          )}
          <p className="mt-1 text-body text-ink-muted">
            Click anywhere or zoom in to start exploring. Every value says where it comes from.
          </p>
          {site && onStart && (
            // Leaves welcome itself (goToSite), so the shell's pointer-down
            // must not unmount it before this click lands.
            <button
              type="button"
              data-keeps-welcome=""
              onClick={onStart}
              className="mt-3 rounded-control border border-line px-4 py-2 text-body text-accent transition-colors duration-(--duration-fast) hover:bg-accent/15 focus-visible:bg-accent/15"
            >
              Go to {site.name}
            </button>
          )}
          {ellipseReason !== null && (
            <p className="mt-2 text-caption text-ink-subtle">Landing ellipse not shown: {ellipseReason}</p>
          )}
        </div>
        <button
          type="button"
          aria-label="Close intro"
          onClick={onClose}
          className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink"
        >
          ×
        </button>
      </header>

      <Panel surface="glass">
        <div className="flex items-start gap-4">
          <Picture layer={picture} />
          <dl className="flex min-w-0 flex-1 flex-col gap-3 text-body">
            {Object.entries(constants).map(([id, c]) => (
              <div key={id}>
                <dt className="text-caption text-ink-subtle">{c.label}</dt>
                <dd>
                  <ClassifiedValue value={c.value} format={(v) => `${v} ${c.unit}`} />
                  {c.note && <p className="mt-1 text-caption text-ink-subtle">{c.note}</p>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        {picture?.previewUrl != null && (
          // Inline, so the mark follows the last word instead of wrapping alone.
          <p className="mt-3 text-caption text-ink-subtle">
            Picture: one Mars Trek map tile, cropped round; not a photo of the globe.
            {picture.caveat !== null && ` ${picture.caveat}.`}{' '}
            <span className="inline-block align-middle">
              <ClassificationBadge classification={picture.classification} detail={picture.source} />
            </span>
          </p>
        )}
      </Panel>
    </div>
  )
}

/**
 * The base layer's preview tile in a circle. Until the catalogue arrives,
 * or for a layer without a preview, a plain disc: no stand-in picture.
 */
function Picture({ layer }: { layer: MapLayer | null }) {
  if (layer?.previewUrl == null) {
    return <span aria-hidden="true" className="size-16 shrink-0 rounded-full bg-surface-raised" />
  }
  return (
    <img
      src={layer.previewUrl}
      alt={`${layer.label}, one map tile`}
      title={`${layer.source} · ${layer.licence}`}
      width={64}
      height={64}
      className="size-16 shrink-0 rounded-full object-cover shadow-panel"
    />
  )
}
