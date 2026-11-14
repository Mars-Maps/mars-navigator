import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { MarsCoordinate } from '../../domain'
import { checkPair, pairText, wholePoint, type PairCheck } from './coordinatePair'
import { leaveOf, rowAction } from './rowFocus'

type PairText = { x: string; y: string }

/**
 * One point as two inputs: X, the longitude in degrees east, then Y,
 * the latitude. Keeps its own text so invalid input stays visible; commits
 * on Enter or when focus leaves the whole group (rowAction). A whole point
 * pasted or typed into either field fills both. Follows the store when the
 * value changes from outside (a reorder, a cleared route).
 */
export function CoordinateField({
  label,
  caption,
  focusKey,
  value,
  required = false,
  holdFocusKey,
  trailing,
  onErrorChange,
  onCommit,
}: {
  label: string
  /** Shown after the label only, not in the inputs' names: a marked point's description. */
  caption?: string | null
  /** On the X input; the Y input is `${focusKey}-y`. */
  focusKey: string
  value: MarsCoordinate | null
  /** Empty commits null either way; a required one also shows an error. */
  required?: boolean
  /** Focus key of a control in `trailing` that focus may rest on without committing (a cancel button). */
  holdFocusKey?: string
  /** Rendered after the inputs, inside the group. */
  trailing?: ReactNode
  /** Told whenever this point gains or loses an error, and false on unmount. */
  onErrorChange: (focusKey: string, hasError: boolean) => void
  /** Called with null for empty, half-filled or invalid text, required or not. */
  onCommit: (coordinate: MarsCoordinate | null, via: 'enter' | 'blur') => void
}) {
  const id = useId()
  const group = useRef<HTMLDivElement>(null)
  const [text, setText] = useState<PairText>(() => pairText(value))
  const [shown, setShown] = useState<PairCheck | null>(null)
  const [seen, setSeen] = useState(value)
  // Text of the last commit. Enter then blur must not commit twice — for a
  // new stop that would add it twice.
  const committed = useRef(keyOf(text))
  // Text last taken from the store. A new object per resync, so the effect
  // below runs even when the text repeats.
  const [synced, setSynced] = useState(() => ({ key: keyOf(text) }))
  // That text came from the store, so focus-then-blur must not commit it
  // back (rounded) as if it had been typed.
  useEffect(() => {
    committed.current = synced.key
  }, [synced])

  const error = shown?.error ?? null
  const hasError = error !== null
  useEffect(() => {
    onErrorChange(focusKey, hasError)
    return () => onErrorChange(focusKey, false)
  }, [focusKey, hasError, onErrorChange])

  // Adjust during render when the store moved under us. If the text already
  // agrees with the store (it was the source), leave the user's typing alone.
  if (value !== seen) {
    setSeen(value)
    const typed = checkPair(text.x, text.y).coordinate
    const agrees = typed ? sameCoordinate(typed, value) : value === null
    if (!agrees) {
      const next = pairText(value)
      setText(next)
      setShown(null)
      setSynced({ key: keyOf(next) })
    }
  }

  const commit = (via: 'enter' | 'blur') => {
    // "lat, lon" or the copied form typed into one field fills both.
    const whole = wholePoint(text.x) ?? wholePoint(text.y)
    const next = whole ? pairText(whole) : text
    if (keyOf(next) === committed.current) return
    committed.current = keyOf(next)
    if (whole) setText(next)
    const result: PairCheck = whole
      ? { coordinate: whole, error: null, invalidX: false, invalidY: false }
      : checkPair(next.x, next.y, required)
    setShown(result)
    // A required point still commits null: the store must not keep the
    // value the user just cleared.
    onCommit(result.coordinate, via)
  }

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const element = (t: EventTarget | null) => (t instanceof HTMLElement ? t : null)
    const leave = leaveOf(element(e.target), element(e.relatedTarget), group.current, holdFocusKey)
    if (rowAction(leave) === 'commit') commit('blur')
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = wholePoint(e.clipboardData.getData('text'))
    if (!pasted) return
    e.preventDefault()
    setText(pairText(pasted))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit('enter')
    }
  }
  const shared = {
    required,
    describedBy: error ? `${id}-error` : undefined,
    onPaste,
    onKeyDown,
  }

  return (
    <div ref={group} role="group" aria-labelledby={`${id}-label`} onBlur={onBlur}>
      <p id={`${id}-label`} className="mb-1 text-micro uppercase text-ink-subtle">
        {label}
        {caption && <span className="normal-case text-ink-muted"> · {caption}</span>}
      </p>
      <div className="flex items-center gap-2">
        <AxisInput
          {...shared}
          name="X"
          placeholder="lon °E"
          label={`${label} X, longitude °E`}
          focusKey={focusKey}
          value={text.x}
          invalid={shown?.invalidX ?? false}
          onChange={(x) => setText((t) => ({ ...t, x }))}
        />
        <AxisInput
          {...shared}
          name="Y"
          placeholder="lat"
          label={`${label} Y, latitude`}
          focusKey={`${focusKey}-y`}
          value={text.y}
          invalid={shown?.invalidY ?? false}
          onChange={(y) => setText((t) => ({ ...t, y }))}
        />
        {trailing}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function AxisInput({
  name,
  placeholder,
  label,
  focusKey,
  value,
  invalid,
  required,
  describedBy,
  onChange,
  onPaste,
  onKeyDown,
}: {
  name: 'X' | 'Y'
  placeholder: string
  label: string
  focusKey: string
  value: string
  invalid: boolean
  required: boolean
  describedBy: string | undefined
  onChange: (text: string) => void
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <span aria-hidden="true" className="text-micro text-ink-subtle">
        {name}
      </span>
      <input
        data-focus={focusKey}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        aria-invalid={invalid}
        aria-required={required || undefined}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`w-full min-w-0 rounded-control border bg-surface px-2 py-2 text-body tabular-nums text-ink placeholder:text-ink-subtle ${
          invalid ? 'border-danger/40' : 'border-line'
        }`}
      />
    </span>
  )
}

function keyOf(t: PairText): string {
  return `${t.x}|${t.y}`
}

function sameCoordinate(a: MarsCoordinate, b: MarsCoordinate | null): boolean {
  return b !== null && a.latitude === b.latitude && a.longitudeEast === b.longitudeEast
}
