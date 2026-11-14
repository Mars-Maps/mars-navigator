import type { ReactNode } from 'react'
import { ClassificationBadge } from '../../components/ClassificationBadge'
import { Panel } from '../../components/Panel'
import { PanelHeader } from '../../components/PanelHeader'
import { useMinimized } from '../../components/useMinimized'
import {
  BASE_MAP_LAYER_ID,
  type Classified,
  type LegendEntry,
  type MapLayer,
  type MapLayerId,
  type MapLayerLegend,
} from '../../domain'
import { useLayerLegends, useMissionStore } from '../../state'
import { LayerLegendRamp } from './LayerLegendRamp'
import { shortTitle } from './layerTitle'
import { ThermalSettings } from './ThermalSettings'
import type { LayerMenuMove } from './useLayerMenuDrag'

/**
 * The layer picker: a 2 × 2 grid of preview tiles,
 * one per layer, with the layer's name under each, and below the grid the
 * active layer's legend, and for the thermal layer its Day / Night
 * settings. Nothing else: provenance, caveat
 * and licence of what is on the globe are in the scene's caption, and the
 * caveat is this tile's tooltip. The list is the store's `layers`, which
 * the layer adapter fills; a legend of named classes comes from the
 * legends store, which the shell fills from the producer. Selecting
 * only writes `activeLayerId`; the scene reacts to the store.
 */
export function LayerMenu({ move }: { move?: LayerMenuMove }) {
  const layers = useMissionStore((s) => s.layers)
  const activeLayerId = useMissionStore((s) => s.activeLayerId)
  const setActiveLayer = useMissionStore((s) => s.setActiveLayer)
  const legendEntries = useLayerLegends((s) => s.byLayer[activeLayerId])

  return (
    <LayerMenuView
      layers={layers}
      activeLayerId={activeLayerId}
      legendEntries={legendEntries}
      onSelect={setActiveLayer}
      move={move}
      // Mounted only for thermal, so the clock it reads ticks nothing else.
      thermal={activeLayerId === 'thermal' ? <ThermalSettings /> : null}
    />
  )
}

/** The menu itself, prop-driven so it renders and tests without the store. */
export function LayerMenuView({
  layers,
  activeLayerId,
  legendEntries,
  onSelect,
  move,
  thermal = null,
}: {
  layers: MapLayer[]
  activeLayerId: MapLayerId
  /** The active layer's named classes, once read; undefined while they are. */
  legendEntries?: Classified<LegendEntry[]>
  onSelect: (id: MapLayerId) => void
  /** Makes the title bar a handle that moves the menu; the icon panel passes it. */
  move?: LayerMenuMove
  /** The thermal layer's variant settings, above its legend; null for other layers. */
  thermal?: ReactNode
}) {
  const active = layers.find((l) => l.id === activeLayerId)
  // Under every other preview's gaps, greyed, as on the globe.
  const basePreview = layers.find((l) => l.id === BASE_MAP_LAYER_ID)?.previewUrl ?? null

  const { minimized, toggle, bodyId } = useMinimized()

  // No ×: the icon panel's Layers button closes it.
  return (
    <Panel surface="glass" compact={minimized}>
      {/* The whole bar drags, its minimise button excepted; the grip
          is the same handle for the keyboard. */}
      <div
        onPointerDown={move?.onPointerDown}
        onPointerMove={move?.onPointerMove}
        onPointerUp={move?.onPointerUp}
        onPointerCancel={move?.onPointerCancel}
        onDoubleClick={move?.onDoubleClick}
        className={
          move
            ? 'cursor-grab touch-none select-none active:cursor-grabbing [&_button:not([data-drag-grip])]:cursor-default'
            : undefined
        }
      >
        <PanelHeader
          title="Layers"
          minimized={minimized}
          onToggleMinimized={toggle}
          bodyId={bodyId}
          spacing="mb-3"
        >
          <div className="flex items-center gap-1">
            {move && <MoveGrip onKeyDown={move.onKeyDown} />}
            <h2 className="text-heading font-semibold text-ink">Layers</h2>
          </div>
        </PanelHeader>
      </div>

      {!minimized && (
        <div id={bodyId}>
          {layers.length === 0 ? (
            // An empty list is not a list of empty layers: say why nothing shows. The list
            <p className="text-caption text-ink-subtle">Layer data not loaded yet.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3">
              {layers.map((layer) => (
                <li key={layer.id}>
                  <LayerTile
                    layer={layer}
                    basePreview={layer.id === BASE_MAP_LAYER_ID ? null : basePreview}
                    selected={layer.id === activeLayerId}
                    onSelect={() => onSelect(layer.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          {/* The lower half: the active layer's legend. Kept at height so
              the panel reads as one rectangle. The thermal settings come first:
              they choose which variant, and so which legend, is shown.
              Outside the legend's branch: if the night mosaic failed its check,
              thermal leaves the list, and Day must still be there to go back. */}
          <section className="mt-4 min-h-40 border-t border-line pt-4">
            {thermal}
            {active ? (
              <>
                <h3 className="mb-1 text-micro font-medium uppercase text-ink-subtle">
                  {shortTitle(active.label)} legend
                </h3>
                <LayerLegend legend={active.legend} entries={legendEntries} />
              </>
            ) : layers.length > 0 ? (
              // The store keeps `activeLayerId` when `setLayers` drops it: say so
              // rather than leaving no tile selected without a reason.
              <p className="text-caption text-ink-subtle">
                Selected layer “{activeLayerId}” is not loaded. Pick another.
              </p>
            ) : null}
          </section>
        </div>
      )}
    </Panel>
  )
}

/**
 * The keyboard's way to move the menu: arrow keys step it, Home puts
 * it back. A pointer drags anywhere on the bar, this grip included.
 */
function MoveGrip({ onKeyDown }: { onKeyDown: LayerMenuMove['onKeyDown'] }) {
  const label = 'Move Layers: drag, or arrow keys; Home or double-click puts it back'
  return (
    <button
      type="button"
      data-drag-grip=""
      aria-label={label}
      title={label}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home"
      onKeyDown={onKeyDown}
      className="-ml-2 flex size-6 items-center justify-center rounded-control text-ink-subtle transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink focus-visible:text-ink"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
        <circle cx="9" cy="6" r="1.5" />
        <circle cx="15" cy="6" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="9" cy="18" r="1.5" />
        <circle cx="15" cy="18" r="1.5" />
      </svg>
    </button>
  )
}

/**
 * A legend in words. A scale's colour bar is the producer's, linked rather
 * than drawn: its terms do not say it may be copied, and colours sampled
 * from it would be a derived legend. A list of named classes shows
 * the producer's own swatches, read from its legend service. A
 * ramp is this project's own colour scale over a dataset, and says so.
 */
function LayerLegend({
  legend,
  entries,
}: {
  legend: MapLayerLegend
  entries?: Classified<LegendEntry[]>
}) {
  if (legend.kind === 'none') {
    return (
      <>
        <p className="text-body text-ink-muted">No official legend</p>
        {/* Reasons cite URLs, which must wrap inside the narrow menu. */}
        <p className="mt-1 text-caption break-words text-ink-subtle">{legend.reason}</p>
      </>
    )
  }
  if (legend.kind === 'ramp') return <LayerLegendRamp legend={legend} />
  if (legend.kind === 'categories') {
    return (
      <>
        <p className="flex items-center gap-2 text-body text-ink-muted">
          {legend.quantity}
          <ClassificationBadge classification="OFFICIAL" detail={legend.source} />
        </p>
        <CategoryList entries={entries} />
        <a
          href={legend.publicationUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-caption text-accent underline"
        >
          Map sheet and pamphlet (opens the source)
        </a>
      </>
    )
  }
  return (
    <>
      <p className="flex items-center gap-2 text-body text-ink-muted">
        {legend.quantity}
        <ClassificationBadge classification="OFFICIAL" detail={legend.source} />
      </p>
      <ul className="mt-2 text-body text-ink">
        <li className="tabular-nums">
          {legend.min} to {legend.max}
        </li>
        {legend.marks.map((mark) => (
          <li key={mark.value} className="tabular-nums">
            {mark.value}: {mark.label}
          </li>
        ))}
      </ul>
      <a
        href={legend.imageUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-block text-caption text-accent underline"
      >
        Official colour bar (opens the source)
      </a>
    </>
  )
}

/**
 * The named classes with their swatches, or the state of reading them: no
 * entry is invented while the producer's legend is on its way or failed.
 */
function CategoryList({ entries }: { entries?: Classified<LegendEntry[]> }) {
  if (entries === undefined) {
    return <p className="mt-2 text-caption text-ink-subtle">Reading the official legend…</p>
  }
  if (entries.classification === 'UNAVAILABLE') {
    return (
      <p className="mt-2 flex items-center gap-2 text-caption text-ink-subtle">
        Official legend unavailable
        <ClassificationBadge classification="UNAVAILABLE" detail={entries.reason} />
      </p>
    )
  }
  // No scroll box of its own: the menu's wrapper is the one scroll region
  // (IconPanel caps its height), so a long legend scrolls with the menu.
  return (
    <ul data-legend-entries="" className="mt-2 text-caption text-ink">
      {entries.value.map((entry, i) => (
        // Index in the key: a producer may repeat a label for a class with
        // several symbols, and two equal keys would drop a row.
        <li key={`${i}-${entry.label}`} className="flex items-center gap-2 py-0.5">
          {/* Decorative: the name beside it is the text. */}
          <img src={entry.swatchUrl} alt="" width={14} height={14} className="size-3.5 shrink-0" />
          {entry.label}
        </li>
      ))}
    </ul>
  )
}

function LayerTile({
  layer,
  basePreview,
  selected,
  onSelect,
}: {
  layer: MapLayer
  /** Shown greyed under this preview's transparent pixels, or null for none. */
  basePreview: string | null
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={layer.label}
      title={layer.caveat ?? layer.label}
      onClick={onSelect}
      className={`group flex w-full flex-col items-center gap-2 rounded-control p-1 text-left transition-colors duration-(--duration-fast) ${
        selected ? 'text-accent' : 'text-ink-muted hover:text-ink'
      }`}
    >
      <span
        className={`relative block aspect-square w-full overflow-hidden rounded-control border bg-surface transition-colors duration-(--duration-fast) ${
          selected
            ? 'border-accent ring-2 ring-accent/40'
            : 'border-line group-hover:border-line-strong'
        }`}
      >
        {layer.previewUrl !== null && basePreview !== null && (
          <img
            src={basePreview}
            alt=""
            loading="lazy"
            draggable={false}
            className="absolute inset-0 size-full object-cover brightness-50 grayscale"
          />
        )}
        {layer.previewUrl !== null ? (
          // Decorative: the name below is the accessible text.
          <img
            src={layer.previewUrl}
            alt=""
            loading="lazy"
            draggable={false}
            className="relative size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-caption text-ink-subtle">
            No preview
          </span>
        )}
      </span>
      <span className="text-body font-medium">{shortTitle(layer.label)}</span>
    </button>
  )
}
