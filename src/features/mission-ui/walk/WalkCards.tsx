import { useId } from 'react'
import { ClassificationBadge, InfoMark } from '../../../components/ClassificationBadge'
import { Methodology, MethodologyItem } from '../../../components/Methodology'
import type { WalkKind } from '../../../domain'
import { ClassifiedValue } from '../ClassifiedValue'
import {
  WALK_KIND_TEXT,
  brokenLine,
  cardFigures,
  energyCaveat,
  orderedWalks,
  samplesLine,
  uncheckedLine,
  type PlannedWalk,
  type WalkOption,
} from './walkCardFigures'

/**
 * The three walks of step 3 as cards. They are native radios, as the
 * route options are: the arrows move the selection with no keyboard
 * code of our own. The input is visually hidden, so the card carries the
 * focus ring. The radio's label is the walk's name and purpose only: the
 * figures and their marks sit beside it in the card, so a mark can be
 * opened (its own Tab stop) without selecting the walk, and a screen
 * reader names each option in a few words. A walk that could not be planned stays in
 * the list, disabled, with its reason, so the user sees why there are fewer
 * than three. Selecting a card selects that plan in the store; the shell
 * does it (`onSelect`).
 */
export function WalkCards({
  walks,
  selectedKind,
  onSelect,
}: {
  walks: readonly WalkOption[]
  /** The kind of the plan selected in the store; null with none. */
  selectedKind: WalkKind | null
  onSelect: (kind: WalkKind) => void
}) {
  const name = useId()
  const caveat = energyCaveat(walks)
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1 text-caption text-ink-subtle">Walks</legend>
      {orderedWalks(walks).map((walk) => {
        const text = WALK_KIND_TEXT[walk.kind]
        const planned = walk.status === 'planned'
        const selected = planned && walk.kind === selectedKind
        return (
          <div
            key={walk.kind}
            className={`flex flex-col gap-1 rounded-control border px-2.5 py-2 text-caption transition-colors duration-(--duration-fast) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-(--color-focus) ${
              !planned
                ? 'cursor-not-allowed border-line text-ink-subtle'
                : selected
                  ? 'cursor-pointer border-accent/50 bg-accent/15 text-ink'
                  : 'cursor-pointer border-line text-ink-muted hover:bg-surface-raised hover:text-ink'
            }`}
          >
            <label className={`flex flex-col gap-1 ${planned ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
              <input
                type="radio"
                name={name}
                value={walk.kind}
                checked={selected}
                disabled={!planned}
                onChange={() => onSelect(walk.kind)}
                className="sr-only"
              />
              <span className={`text-body font-medium ${planned ? 'text-ink' : 'text-ink-muted'}`}>{text.name}</span>
              <span className="text-ink-muted">{text.purpose}</span>
            </label>
            {walk.status === 'planned' ? (
              <PlannedFigures walk={walk} />
            ) : (
              <span className="flex items-center gap-1.5">
                {/* Why not is in the mark: it can run to several lines. */}
                <span className="text-ink-subtle italic">Not planned</span>
                <ClassificationBadge classification="UNAVAILABLE" detail={walk.reason} />
              </span>
            )}
          </div>
        )
      })}
      {/* Every fit carries this: a walk "within" its energy is within it on the walking only. */}
      {caveat && (
        <p className="flex items-center gap-1.5 text-caption text-ink-muted">
          Energy is the walking only
          <InfoMark detail={`${caveat}.`} />
        </p>
      )}
    </fieldset>
  )
}

/** A planned walk's figures against its settings, its samples, and the limits it breaks or could not be checked on. */
function PlannedFigures({ walk }: { walk: PlannedWalk }) {
  const samples = samplesLine(walk.plan)
  const broken = brokenLine(walk.fit)
  const unchecked = uncheckedLine(walk.fit)
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {cardFigures(walk).map((f) => (
          <div key={f.key} className="contents">
            <dt className="text-ink-subtle">{f.label}</dt>
            <dd className="flex flex-wrap items-baseline gap-x-1.5">
              <ClassifiedValue value={f.value} format={f.format} />
              {f.limit && <span className={f.over ? 'text-danger' : 'text-ink-subtle'}>{f.limit}</span>}
            </dd>
          </div>
        ))}
        {samples && (
          <div className="contents">
            <dt className="text-ink-subtle">Samples</dt>
            <dd className="tabular-nums text-ink">{samples}</dd>
          </div>
        )}
      </dl>
      {/* What the walk leaves out and why can run to a paragraph: one click away, not in the card. */}
      {walk.samplesNote && (
        <span>
          <Methodology title={`${WALK_KIND_TEXT[walk.kind].name}: what it leaves out and why`}>
            <MethodologyItem>{walk.samplesNote}</MethodologyItem>
          </Methodology>
        </span>
      )}
      {broken && <span className="text-danger">{broken}</span>}
      {unchecked && <span className="text-ink-muted">{unchecked}</span>}
    </>
  )
}
