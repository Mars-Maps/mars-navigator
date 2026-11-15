import { Suspense, lazy, useRef, type ReactNode } from 'react'
import { useMissionStore, useSite, type SidePanelId } from '../../state'
import { ErrorBoundary, FailedPart, LoadingPart } from '../../components/ErrorBoundary'
import { COMPASS_DIAL_ID } from './CompassDial'
import { useEscapeLayer } from '../../lib/useEscapeLayer'
import { useLayerMenuDrag } from './useLayerMenuDrag'

// The layer menu opens on a press of its button, so its code (the menu, its
// legends and the thermal settings) is not in the first load.
const LayerMenu = lazy(() => import('./LayerMenu').then((m) => ({ default: m.LayerMenu })))

/**
 * Right-side vertical controls: site, grid, zoom, layers, compass. Every button
 * only writes store state — the grid and camera (mars-3d) react to it, so
 * this panel never talks to the scene directly.
 */
export function IconPanel() {
  const gridVisible = useMissionStore((s) => s.gridVisible)
  const open = useMissionStore((s) => s.openSidePanels)
  const toggleGrid = useMissionStore((s) => s.toggleGrid)
  const toggleSidePanel = useMissionStore((s) => s.toggleSidePanel)
  const closeSidePanel = useMissionStore((s) => s.closeSidePanel)
  const requestZoom = useMissionStore((s) => s.requestZoom)
  // The site the app is about: one press flies there from any view.
  const siteName = useSite((s) => s.site?.name ?? null)
  const goToSite = useSite((s) => s.goToSite)
  // The slot is not shown on the surface, so a layer menu or compass
  // left open stays open in the store and returns with the globe.
  // The layer menu and compass open independently.
  // The compass dial is its own slot at the bottom right; this panel
  // only holds its toggle and its Escape layer.
  const showLayers = open.layers
  const showCompass = open.compass

  // Each shown sub-panel is its own Escape layer: one press closes
  // the one shown last, the next press the other. Close, never toggle, so a
  // repeated press cannot reopen a panel.
  useEscapeLayer(showLayers, () => closeSidePanel('layers'))
  useEscapeLayer(showCompass, () => closeSidePanel('compass'))


  // Always a column; the slot decides where.
  return (
    <nav aria-label="Map controls" className="relative flex h-full items-center justify-center">
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-panel border border-line/60 bg-surface/70 p-1 shadow-panel backdrop-blur-glass">
        {siteName !== null && (
          <>
            <IconButton label={`Go to ${siteName}`} onClick={goToSite}>
              <SiteIcon />
            </IconButton>
            <Divider />
          </>
        )}
        <IconButton label="Coordinate grid" pressed={gridVisible} onClick={toggleGrid}>
          <GridIcon />
        </IconButton>

        <Divider />

        <IconButton label="Zoom in" onClick={() => requestZoom('in')}>
          <PlusIcon />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => requestZoom('out')}>
          <MinusIcon />
        </IconButton>

        <Divider />

        <IconButton
          label="Layers"
          expanded={open.layers}
          controls={SUB_PANEL_ID.layers}
          onClick={() => toggleSidePanel('layers')}
        >
          <LayersIcon />
        </IconButton>
        <IconButton
          label="Compass"
          expanded={open.compass}
          controls={SUB_PANEL_ID.compass}
          onClick={() => toggleSidePanel('compass')}
        >
          <CompassIcon />
        </IconButton>
      </div>

      {/* The layer menu beside the column, on its left. The slot sets where it
          hangs and how tall it may grow, so it clears the time menu,
          the walker widget, the compass and the tool dock; the menu scrolls
          inside that height. */}
      {showLayers && <MovableLayerMenu id={SUB_PANEL_ID.layers} />}
    </nav>
  )
}

/**
 * The layer menu, movable while it is open. Its drag lives here, in a
 * component that exists only while the menu is shown, so closing the menu
 * forgets the position and it reopens at its default place. Dragged,
 * it moves by an offset from that place.
 */
function MovableLayerMenu({ id }: { id: string }) {
  const box = useRef<HTMLDivElement>(null)
  const { offset, move } = useLayerMenuDrag(box)
  return (
    <div
      ref={box}
      id={id}
      style={{ translate: `${offset.dx}px ${offset.dy}px` }}
      className="absolute right-full top-(--icons-menu-top) mr-2 max-h-(--icons-menu-max) w-80 overflow-y-auto"
    >
      <ErrorBoundary fallback={() => <FailedPart what="The layer menu" panel />}>
        <Suspense fallback={<LoadingPart what="the layer menu" />}>
          <LayerMenu move={move} />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}

const SUB_PANEL_ID: Record<SidePanelId, string> = {
  layers: 'icon-panel-layers',
  // The dial's own slot.
  compass: COMPASS_DIAL_ID,
}

function IconButton({
  label,
  pressed,
  expanded,
  controls,
  onClick,
  children,
}: {
  label: string
  /** Set for on/off toggles. */
  pressed?: boolean
  /** Set for buttons that open a sub-panel. */
  expanded?: boolean
  controls?: string
  onClick: () => void
  children: ReactNode
}) {
  const active = pressed || expanded
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      // Only the sub-panel toggles carry aria-expanded: slots.ts raises the
      // slot when one is true. The progress tracker is in the left
      // column, so nothing hides for the layer menu any more.
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      onClick={onClick}
      className={`flex size-10 items-center justify-center rounded-control transition-colors duration-(--duration-fast) ${
        active
          ? 'bg-accent/15 text-accent'
          : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <hr className="my-1 w-6 border-line" />
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** A map pin: the site's mark on the globe is the same shape (SiteLabel). */
function SiteIcon() {
  return (
    <Svg>
      <path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z" />
      <circle cx="12" cy="10" r="2" />
    </Svg>
  )
}

function GridIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
    </Svg>
  )
}

function PlusIcon() {
  return (
    <Svg>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

function MinusIcon() {
  return (
    <Svg>
      <path d="M5 12h14" />
    </Svg>
  )
}

function LayersIcon() {
  return (
    <Svg>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </Svg>
  )
}

function CompassIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </Svg>
  )
}
