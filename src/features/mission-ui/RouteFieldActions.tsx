import { useEffect } from 'react'
import { formatMarsCoordinate } from '../../domain'
import { describeRoutePick, useMissionStore, useRoutePick, writeRouteSlot, type RoutePickSlot } from '../../state'
import { useEscapeLayer } from '../../lib/useEscapeLayer'

/**
 * Beside a route field in the search bar: "Pick on the globe", which
 * makes the next click on the surface fill the field, and, when any point
 * is marked, a menu of the marked points by description and coordinate.
 * Both write through the store, and the field follows its value.
 */
export function RouteFieldActions({ slot, name }: { slot: RoutePickSlot; name: string }) {
  const markers = useMissionStore((s) => s.markers)
  const active = useRoutePick((s) => s.slot === slot)
  const startRoutePick = useRoutePick((s) => s.startRoutePick)
  const cancelRoutePick = useRoutePick((s) => s.cancelRoutePick)
  const pickLabel = active ? `Cancel picking the ${name}` : `Pick the ${name} on the globe`
  return (
    <>
      <button
        type="button"
        aria-label={pickLabel}
        title={pickLabel}
        aria-pressed={active}
        // A press leaves focus where it is, so a focused field does not blur and commit.
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => (active ? cancelRoutePick() : startRoutePick(slot))}
        className={`flex size-9 shrink-0 items-center justify-center rounded-control transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink ${
          active ? 'bg-accent/15 text-accent' : 'text-ink-muted'
        }`}
      >
        <PickIcon />
      </button>
      {markers.length > 0 && (
        // A native select over an icon: keyboard and screen readers get a real listbox.
        <label className="relative flex size-9 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink">
          <MarkerIcon />
          <span className="sr-only">{`Use a marked point as the ${name}`}</span>
          <select
            value=""
            title={`Use a marked point as the ${name}`}
            onChange={(e) => {
              const marker = markers.find((m) => m.id === e.target.value)
              if (marker) writeRouteSlot(slot, marker.coordinate)
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            <option value="" disabled>
              Marked points
            </option>
            {markers.map((m) => (
              <option key={m.id} value={m.id}>
                {`${m.label ?? 'Unnamed point'} · ${formatMarsCoordinate(m.coordinate)}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  )
}

/**
 * While a pick is running: what the next click does, and that Escape
 * cancels it. Escape takes the pick off first, as the newest layer.
 * A pick never outlives the editable search bar: it ends when navigation
 * or the surface view takes its place.
 */
export function RoutePickNotice() {
  const slot = useRoutePick((s) => s.slot)
  const cancelRoutePick = useRoutePick((s) => s.cancelRoutePick)
  useEscapeLayer(slot !== null, cancelRoutePick)
  useEffect(() => () => useRoutePick.getState().cancelRoutePick(), [])
  return (
    <p aria-live="polite" className={slot === null ? 'sr-only' : 'mt-2 text-caption text-accent'}>
      {slot !== null && `${describeRoutePick(slot)}. Esc to cancel.`}
    </p>
  )
}

function PickIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="5" />
      <path d="M10 2v4M10 14v4M2 10h4M14 10h4" strokeLinecap="round" />
    </svg>
  )
}

function MarkerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 18V3M5 3h9l-2 3.5L14 10H5" strokeLinejoin="round" />
    </svg>
  )
}
