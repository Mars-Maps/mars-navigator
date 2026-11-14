import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import type { SurfacePoint } from '../../../domain'
import { MAX_RESULTS, searchPlaces, typeCounts, type Place, type SearchResult, type TypeFilter } from './placeSearch'

/** Where the shell's read of the place names is. */
export type PlaceNamesStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; places: readonly Place[]; source: string }
  | { kind: 'failed'; reason: string }

const NO_PLACES: readonly Place[] = []

/**
 * The Search & Go To tool's panel: type a place name, one of your
 * marked points, or a coordinate, and Go to flies there. The list scrolls;
 * a type filter narrows it to one kind of feature (Crater, Patera…) or the
 * marked points, and with a type chosen and nothing typed it lists every
 * one of that type, largest first. Renders from
 * props; the shell reads the names and moves the camera. The names are
 * OFFICIAL, from the Gazetteer, and the panel says so; while they cannot be
 * read, marked points and coordinates still work, and the panel says why.
 */
export function SearchGoToView({
  names,
  markers,
  onGoTo,
}: {
  names: PlaceNamesStatus
  markers: readonly SurfacePoint[]
  onGoTo: (result: SearchResult) => void
}) {
  const [query, setQuery] = useState('')
  const [type, setType] = useState<TypeFilter>(null)
  const [active, setActive] = useState(0)
  const { minimized, toggle, bodyId } = useMinimized()
  const listId = useId()
  const list = useRef<HTMLUListElement>(null)
  const places = names.kind === 'ready' ? names.places : NO_PLACES
  const types = useMemo(() => typeCounts(places, markers.length), [places, markers.length])
  const { results, total } = useMemo(() => searchPlaces(query, places, markers, type), [query, places, markers, type])
  const current = Math.min(active, results.length - 1)
  const browsing = query.trim() === ''

  // Arrow keys keep the highlighted row in the scrolled list's view.
  useEffect(() => {
    list.current?.querySelector(`[data-row="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((current + step + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onGoTo(results[current]!)
    }
  }

  // No ×: the dock's button closes a tool's panel.
  return (
    <Panel surface="glass" compact={minimized} className="max-h-[calc(100vh-10rem)] w-full overflow-y-auto">
      <PanelHeader title="Search & Go To" minimized={minimized} onToggleMinimized={toggle} bodyId={bodyId} spacing="mb-3">
        <h2 className="text-heading font-semibold text-ink">Search &amp; Go To</h2>
      </PanelHeader>
      {minimized ? null : (
        <div id={bodyId} className="flex flex-col gap-2">
          <input
            type="search"
            // Opening the tool is asking to search: the box takes the typing.
            autoFocus
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={results.length > 0 ? `${listId}-${current}` : undefined}
            aria-label="Place name, marked point or coordinate"
            placeholder="Jezero, Olympus Mons, 18.4, 77.7…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-subtle"
          />
          <label className="flex items-center gap-2 text-caption text-ink-subtle">
            Type
            <select
              value={type ?? ''}
              onChange={(e) => {
                setType(e.target.value === '' ? null : e.target.value)
                setActive(0)
              }}
              className="min-w-0 flex-1 rounded-control border border-line bg-surface px-2 py-1 text-body text-ink"
            >
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t.type} value={t.type}>
                  {`${t.type} (${t.count.toLocaleString('en')})`}
                </option>
              ))}
            </select>
          </label>
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label="Results"
            className="flex max-h-72 flex-col overflow-y-auto overscroll-contain"
          >
            {results.map((r, i) => (
              <li
                key={r.key}
                id={`${listId}-${i}`}
                data-row={i}
                role="option"
                aria-selected={i === current}
                onPointerEnter={() => setActive(i)}
                onClick={() => onGoTo(r)}
                className={`cursor-pointer rounded-control px-2 py-1.5 ${i === current ? 'bg-surface-raised' : ''}`}
              >
                <p className="text-body text-ink">{r.title}</p>
                <p className="text-caption tabular-nums text-ink-muted">{r.detail}</p>
              </li>
            ))}
          </ul>
          <p aria-live="polite" className="text-caption text-ink-subtle">
            {countLine(total, results.length, browsing, type)}
          </p>
          <SourceLine names={names} />
        </div>
      )}
    </Panel>
  )
}

/** Under the list: nothing to say, no match, how many, or that the list stops at MAX_RESULTS. */
function countLine(total: number, shown: number, browsing: boolean, type: TypeFilter): string {
  if (browsing && type === null) return ''
  if (total === 0) return type === null ? 'No place, marked point or coordinate matches.' : `No ${type} matches.`
  if (total > shown) return `Showing the first ${MAX_RESULTS} of ${total.toLocaleString('en')}; type more to narrow.`
  return `${total.toLocaleString('en')} ${total === 1 ? 'match' : 'matches'}`
}

function SourceLine({ names }: { names: PlaceNamesStatus }) {
  if (names.kind === 'loading') return <p className="text-caption text-ink-subtle">Reading the place names…</p>
  if (names.kind === 'failed') {
    return (
      <p className="flex items-center gap-1.5 text-caption text-ink-subtle">
        Place names unavailable; marked points and coordinates still work.
        <ClassificationBadge classification="UNAVAILABLE" detail={names.reason} />
      </p>
    )
  }
  return (
    <p className="flex items-center gap-1.5 text-caption text-ink-subtle">
      {`${names.places.length.toLocaleString('en')} names from the USGS Gazetteer of Planetary Nomenclature, at each feature's centre`}
      <ClassificationBadge classification="OFFICIAL" detail={names.source} />
    </p>
  )
}
