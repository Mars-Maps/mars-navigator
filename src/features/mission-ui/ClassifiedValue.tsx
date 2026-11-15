import { isAvailable, type Classified } from '../../domain'
import { ClassificationBadge } from '../../components/ClassificationBadge'

/**
 * Renders a value together with where it came from: the value and the mark,
 * with the source, method or reason in the mark's tooltip. An
 * UNAVAILABLE value shows as unavailable — never as 0, blank, or a guess.
 */
export function ClassifiedValue<T>({
  value,
  format = (v: T) => String(v),
  note,
}: {
  value: Classified<T>
  format?: (v: T) => string
  /** A caveat that belongs with the value: it joins the source in the mark, not the panel. */
  note?: string
}) {
  if (!isAvailable(value)) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-ink-subtle italic">unavailable</span>
        <ClassificationBadge classification={value.classification} detail={note ? `${value.reason}. ${note}` : value.reason} />
      </span>
    )
  }

  const provenance =
    value.classification === 'DERIVED' ? value.method : value.source

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular-nums text-ink">{format(value.value)}</span>
      <ClassificationBadge classification={value.classification} detail={note ? `${provenance}. ${note}` : provenance} />
    </span>
  )
}
