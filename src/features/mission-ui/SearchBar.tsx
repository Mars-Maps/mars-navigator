import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { formatMarsCoordinate, type MarsCoordinate, type RouteRequest } from '../../domain'
import { markerLabelAt, toRouteRequest, useMissionStore, useRoutePick, type RouteDraft } from '../../state'
import { CoordinateField } from './CoordinateField'
import { RouteFieldActions, RoutePickNotice } from './RouteFieldActions'
import { searchBarEscape } from './searchBarEscape'
import { DragHandle, DropLine } from './StopDrag'
import { useStopDrag } from './stopReorder'
import { InfoMark } from '../../components/ClassificationBadge'

/** How the coordinate fields are filled, for the mark beside their one-line key. */
export const COORDINATE_HELP =
  'X is the longitude, 0–360 °E; Y is the latitude, −90 to 90. Paste a copied point (4.6°S 137.4°E) or "lat, lon" into either field to fill both.'

/**
 * Top-left route search: collapsed to one line and the departure's X and Y,
 * expanded to the stops, destination and "+ Add stop". Writes only
 * to `routeDraft` in the store; nothing here computes a route.
 *
 * A point writes its coordinate to the store when its text is valid, and
 * null when it is empty or invalid, so the store never keeps a value the
 * user has replaced. Invalid text is flagged next to the field and
 * never coerced. The route is offered as ready only when no field is
 * flagged and `toRouteRequest` accepts the draft.
 *
 * While navigating it is the planned route's summary line, read-only: the
 * route changes only after End navigation, as `setPoint` already
 * leaves the draft alone in navigation.
 */
export function SearchBar(props: SearchBarProps) {
  const navigating = useMissionStore((s) => s.viewMode === 'navigation')
  const draft = useMissionStore((s) => s.routeDraft)
  return navigating ? <PlannedRoute draft={draft} /> : <EditableSearchBar {...props} />
}

interface SearchBarProps {
  /**
   * Plans the ready route and follows it. The shell supplies it,
   * because planning lives in route-analysis, which this feature does not
   * import.
   */
  onPlan: (request: RouteRequest) => void
}

/** The bar in navigation: one line naming the route being followed. */
export function PlannedRoute({ draft }: { draft: RouteDraft }) {
  const request = toRouteRequest(draft)
  const summary = request
    ? summarize(request.departure, request.destination, request.stops.length)
    : 'Route'
  const hint = 'End navigation to change the route'
  return (
    <div
      role="group"
      aria-label="Planned route"
      title={`${summary}. ${hint}.`}
      className="flex items-center gap-2 rounded-panel border border-line/60 bg-surface/70 px-4 py-3 text-body shadow-panel backdrop-blur-glass"
    >
      <SearchIcon />
      <span className="min-w-0 flex-1 truncate text-ink">{summary}</span>
      <span className="sr-only">{hint}</span>
    </div>
  )
}

function EditableSearchBar({ onPlan }: SearchBarProps) {
  const draft = useMissionStore((s) => s.routeDraft)
  const viewMode = useMissionStore((s) => s.viewMode)
  const setDeparture = useMissionStore((s) => s.setDeparture)
  const setDestination = useMissionStore((s) => s.setDestination)
  const addStop = useMissionStore((s) => s.addStop)
  const updateStop = useMissionStore((s) => s.updateStop)
  // A typed point is selected too, so the point menu shows it, as right-click → Set point does.
  const selectPoint = useMissionStore((s) => s.selectPoint)
  const typed = (c: MarsCoordinate | null) => {
    if (c) selectPoint(c)
  }
  const removeStop = useMissionStore((s) => s.removeStop)
  const moveStopInStore = useMissionStore((s) => s.moveStop)
  const markers = useMissionStore((s) => s.markers)
  const startRoutePick = useRoutePick((s) => s.startRoutePick)

  const [expanded, setExpanded] = useState(false)
  const [addingStop, setAddingStop] = useState(false)
  // Set by "Cancel new stop" so a blur fired as the row unmounts cannot add it.
  const cancelledNewStop = useRef(false)
  // Focus keys of the fields currently showing an error.
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(() => new Set())
  const reportError = useCallback((key: string, hasError: boolean) => {
    setInvalid((prev) => {
      if (prev.has(key) === hasError) return prev
      const next = new Set(prev)
      if (hasError) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])
  // Where keyboard focus goes after the list re-renders (move, remove, add).
  // Every handler that sets it also changes state, so the effect below runs.
  const focusTarget = useRef<string | null>(null)
  const setFocusTarget = (key: string) => {
    focusTarget.current = key
  }

  const toggleRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyId = useId()

  useEffect(() => {
    if (!focusTarget.current) return
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-focus="${focusTarget.current}"]`)
      ?.focus()
    focusTarget.current = null
  })

  const hasErrors = invalid.size > 0
  const request = hasErrors ? null : toRouteRequest(draft)
  // A stop the store holds as not valid. Usually its field shows the
  // error too, but not always: after a remount the field is empty with no
  // error yet, and after a move the row that now holds null resyncs from the
  // store (rows are keyed by index), which clears its text and error.
  const blankStop = draft.stops.indexOf(null)
  const incomplete = hasErrors || blankStop >= 0
  const lastStop = draft.stops.length - 1

  // The departure is always on screen, so opening moves no focus,
  // like the time menu's arrow.
  const open = () => setExpanded(true)
  const close = () => {
    setExpanded(false)
    toggleRef.current?.focus()
  }

  // Escape blurs the focused field on its way out, so it commits rather than
  // reverts. `preventDefault` marks it handled, so the shared Escape rule
  // leaves the other open panels and the active tool alone.
  // A running pick goes first: with the focus in a field this handler
  // sees the press before the pick's own Escape layer, and closing the bar
  // would leave the pick on.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    const action = searchBarEscape(useRoutePick.getState().slot !== null, expanded)
    if (action === null) return
    e.preventDefault()
    if (action === 'cancel-pick') useRoutePick.getState().cancelRoutePick()
    else close()
  }

  // Drag-to-reorder: one store write per drop; focus stays put.
  const drag = useStopDrag(draft.stops.length, moveStopInStore)

  const moveStop = (from: number, to: number) => {
    moveStopInStore(from, to)
    // Follow the stop; at the end of the list its arrow is disabled.
    const dir = to < from ? 'up' : 'down'
    const edge = (dir === 'up' && to === 0) || (dir === 'down' && to === lastStop)
    setFocusTarget(`stop-${to}-${edge ? (dir === 'up' ? 'down' : 'up') : dir}`)
  }

  const onRemoveStop = (index: number) => {
    removeStop(index)
    const remaining = draft.stops.length - 1
    // With the new-stop row open, "+ Add stop" is not rendered.
    const fallback = addingStop ? 'new-stop' : 'add-stop'
    setFocusTarget(
      remaining === 0 ? fallback : `stop-${Math.min(index, remaining - 1)}-remove`,
    )
  }

  // Collapsed it is the summary line and the departure's X and Y.
  // Those stay put; the body under them scrolls. It stops growing at
  // about one stop's worth (23 rem), and on a short window the slot shrinks
  // it further, so the caption and scale bar below stay on screen (slots.ts).
  // Focusing a field scrolls it into view.
  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      className="flex max-h-full min-h-0 flex-col rounded-panel border border-line/60 bg-surface/70 shadow-panel backdrop-blur-glass"
    >
      {/* The summary line, and beside it, while the bar is closed, Plan route
          once the route is ready: set with the mouse alone, a route
          can be planned without opening the fields. */}
      <div className="flex shrink-0 items-center">
        <button
          ref={toggleRef}
          type="button"
          // The search bar's only aria-expanded: slots.ts hides the point menu
          // below while it is true. Keep it the only one.
          aria-expanded={expanded}
          aria-controls={bodyId}
          // No aria-label: the visible summary is the accessible name (WCAG 2.5.3).
          onClick={expanded ? close : open}
          className="flex min-w-0 flex-1 shrink-0 items-center gap-2 rounded-panel px-4 py-3 text-left text-body transition-colors duration-(--duration-fast) hover:bg-surface-raised"
        >
          <SearchIcon />
          <span
            className={`min-w-0 flex-1 truncate ${
              request ? 'text-ink' : incomplete ? 'text-danger' : 'text-ink-subtle'
            }`}
          >
            {request
              ? summarize(request.departure, request.destination, request.stops.length)
              : incomplete
                ? 'Route has an invalid field'
                : 'Search route…'}
          </span>
          <span aria-hidden="true" className="text-ink-subtle">
            {expanded ? '▴' : '▾'}
          </span>
        </button>
        {!expanded && <QuickPlanButton request={request} closeUp={viewMode === 'close-up'} onPlan={onPlan} />}
      </div>

      <div className="shrink-0 px-4 pb-3">
        <CoordinateField
          label="Departure"
          caption={markerLabelAt(markers, draft.departure)}
          focusKey="departure"
          value={draft.departure}
          onErrorChange={reportError}
          onCommit={(c) => (setDeparture(c), typed(c))}
          trailing={<RouteFieldActions slot="departure" name="departure" />}
        />
        <RoutePickNotice />
      </div>

      <div
        id={bodyId}
        hidden={!expanded}
        className="max-h-[23rem] min-h-0 scroll-py-3 overflow-y-auto border-t border-line/60 px-4 pb-4 pt-3"
      >
        <p className="mb-3 flex items-center gap-1.5 text-caption text-ink-subtle">
          X longitude °E · Y latitude
          <InfoMark detail={COORDINATE_HELP} />
        </p>

        <ol className="flex flex-col gap-2">
          {draft.stops.map((stop, i) => (
            <li
              key={i}
              {...drag.rowProps(i)}
              className={`relative flex items-end gap-1 ${drag.dragFrom === i ? 'opacity-50' : ''}`}
            >
              {drag.lineAt === i && <DropLine edge="top" />}
              {drag.lineAt === i + 1 && i === lastStop && <DropLine edge="bottom" />}
              <DragHandle hidden={draft.stops.length < 2} {...drag.handleProps(i)} />
              <div className="min-w-0 flex-1">
                <CoordinateField
                  label={`Stop ${i + 1}`}
                  caption={markerLabelAt(markers, stop)}
                  focusKey={`stop-${i}`}
                  value={stop}
                  required
                  onErrorChange={reportError}
                  onCommit={(c) => (updateStop(i, c), typed(c))}
                  trailing={<RouteFieldActions slot={i} name={`stop ${i + 1}`} />}
                />
              </div>
              <RowButton
                label={`Move stop ${i + 1} up`}
                focusKey={`stop-${i}-up`}
                disabled={i === 0}
                onClick={() => moveStop(i, i - 1)}
              >
                ↑
              </RowButton>
              <RowButton
                label={`Move stop ${i + 1} down`}
                focusKey={`stop-${i}-down`}
                disabled={i === lastStop}
                onClick={() => moveStop(i, i + 1)}
              >
                ↓
              </RowButton>
              <RowButton
                label={`Remove stop ${i + 1}`}
                focusKey={`stop-${i}-remove`}
                onClick={() => onRemoveStop(i)}
              >
                ×
              </RowButton>
            </li>
          ))}

          {/* Where the stop will go, before the destination. The × is part
              of the point's group, so Tab onto it waits and Tab past it adds
              the stop (rowAction). */}
          {addingStop && (
            <li>
              <CoordinateField
                label={`Stop ${draft.stops.length + 1}`}
                focusKey="new-stop"
                value={null}
                holdFocusKey="new-stop-cancel"
                onErrorChange={reportError}
                onCommit={(c, via) => {
                  if (!c || cancelledNewStop.current) return
                  addStop(c)
                  typed(c)
                  setAddingStop(false)
                  if (via === 'enter') setFocusTarget('add-stop')
                }}
                trailing={
                  <>
                    <RowButton
                      label="Pick the new stop on the globe"
                      focusKey="new-stop-pick"
                      keepFocus
                      onClick={() => {
                        cancelledNewStop.current = true
                        setAddingStop(false)
                        setFocusTarget('add-stop')
                        startRoutePick('new-stop')
                      }}
                    >
                      ⌖
                    </RowButton>
                    <RowButton
                      label="Cancel new stop"
                      focusKey="new-stop-cancel"
                      keepFocus
                      onClick={() => {
                        cancelledNewStop.current = true
                        setAddingStop(false)
                        setFocusTarget('add-stop')
                      }}
                    >
                      ×
                    </RowButton>
                  </>
                }
              />
            </li>
          )}

          <li>
            <CoordinateField
              label="Destination"
              caption={markerLabelAt(markers, draft.destination)}
              focusKey="destination"
              value={draft.destination}
              onErrorChange={reportError}
              onCommit={(c) => (setDestination(c), typed(c))}
              trailing={<RouteFieldActions slot="destination" name="destination" />}
            />
          </li>
        </ol>

        {/* At the bottom. With the new-stop row open it is not rendered. */}
        {!addingStop && (
          <button
            type="button"
            data-focus="add-stop"
            onClick={() => {
              cancelledNewStop.current = false
              setAddingStop(true)
              setFocusTarget('new-stop')
            }}
            className="mt-2 rounded-control px-2 py-1 text-body text-accent transition-colors duration-(--duration-fast) hover:bg-accent/15"
          >
            + Add stop
          </button>
        )}

        <p aria-live="polite" className="mt-3 text-caption text-ink-subtle">
          {request
            ? `Route ready · ${request.stops.length} ${request.stops.length === 1 ? 'stop' : 'stops'}`
            : hasErrors
              ? 'Fix or clear the invalid field to use this route'
              : blankStop >= 0
                ? `Stop ${blankStop + 1} needs a coordinate, or remove it`
                : missingEnds(draft.departure, draft.destination)}
        </p>
        {request &&
          (viewMode === 'close-up' ? (
            <button
              type="button"
              onClick={() => onPlan(request)}
              className="mt-2 rounded-control bg-accent/15 px-3 py-1.5 text-body text-accent transition-colors duration-(--duration-fast) hover:bg-accent/25"
            >
              Plan route
            </button>
          ) : (
            // Navigation is entered from close-up only (viewMode.ts).
            <p className="mt-2 text-caption text-ink-subtle">Zoom in to plan this route.</p>
          ))}
      </div>
    </div>
  )
}

function RowButton({
  label,
  focusKey,
  disabled = false,
  keepFocus = false,
  onClick,
  children,
}: {
  label: string
  focusKey: string
  disabled?: boolean
  /** A pointer press leaves focus where it is, so the focused field does not blur and commit. */
  keepFocus?: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-focus={focusKey}
      disabled={disabled}
      onPointerDown={keepFocus ? (e) => e.preventDefault() : undefined}
      onClick={onClick}
      className="flex size-9 shrink-0 items-center justify-center rounded-control text-body text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  )
}

function summarize(from: MarsCoordinate, to: MarsCoordinate, stops: number): string {
  const via = stops > 0 ? ` · ${stops} ${stops === 1 ? 'stop' : 'stops'}` : ''
  return `${formatMarsCoordinate(from)} → ${formatMarsCoordinate(to)}${via}`
}

function missingEnds(departure: MarsCoordinate | null, destination: MarsCoordinate | null): string {
  if (!departure && !destination) return 'Set a departure and destination'
  return departure ? 'Set a destination' : 'Set a departure'
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0 text-ink-subtle">
      <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Plan route on the closed search bar's line: shown once the route
 * is ready (a departure and a destination, no invalid field) and only in
 * close-up, where the open bar's own Plan route works too. A route set with
 * the mouse alone (right-click, Set point, twice) can then be planned
 * without opening the fields. Beside the summary toggle, not inside it: a
 * button cannot hold another.
 */
export function QuickPlanButton({
  request,
  closeUp,
  onPlan,
}: {
  request: RouteRequest | null
  closeUp: boolean
  onPlan: (request: RouteRequest) => void
}) {
  if (!request || !closeUp) return null
  return (
    <button
      type="button"
      onClick={() => onPlan(request)}
      className="mr-3 shrink-0 rounded-control border border-accent/50 bg-accent/15 px-2.5 py-1 text-caption font-medium text-accent transition-colors duration-(--duration-fast) hover:border-accent/80 hover:bg-accent/25"
    >
      Plan route
    </button>
  )
}
