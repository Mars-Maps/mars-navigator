import { describe, expect, it } from 'vitest'
import { NOT_READ_AGAIN, readWithRetries } from '../../src/app/useRoverTraverse'
import { official, unavailable, type Classified, type RoverTraverse } from '../../src/domain'
import { retryingReason } from '../../src/features/mars-3d/traverseLabel'
import { solSliderShown } from '../../src/features/mars-3d/traverseSols'

// Test fixtures only: an invented traverse, never shown in the app.
const FAILED = unavailable<RoverTraverse>('fixture: HTTP 503')
/** What the hook says while the next try waits: the caption lists it but does not open. */
const RETRYING = unavailable<RoverTraverse>(retryingReason('fixture: HTTP 503'))
const READ = official<RoverTraverse>({ rover: 'perseverance', source: 'fixture', retrievedUtcMs: 0, points: [] }, 'fixture')

/** Runs a read that gives `answers` in turn, recording the answers and the waits. */
async function run(answers: Classified<RoverTraverse>[], delays = [5, 20, 60], signal = new AbortController().signal) {
  const given: Classified<RoverTraverse>[] = []
  const waited: number[] = []
  let reads = 0
  await readWithRetries(
    () => Promise.resolve(answers[reads++]),
    (a) => given.push(a),
    signal,
    delays,
    (ms) => {
      waited.push(ms)
      return Promise.resolve()
    },
  )
  return { given, waited, reads }
}

describe('readWithRetries', () => {
  it('stops at the first answer holding a path', async () => {
    const { given, waited, reads } = await run([READ])
    expect(given).toEqual([READ])
    expect(waited).toEqual([])
    expect(reads).toBe(1)
  })

  it('says a failure while it waits, then gives the path that follows', async () => {
    const { given, waited } = await run([FAILED, READ])
    expect(given).toEqual([RETRYING, READ])
    expect(waited).toEqual([5])
  })

  it('gives up after the last delay, leaving the failure standing', async () => {
    const { given, waited, reads } = await run([FAILED, FAILED, FAILED, FAILED, READ])
    expect(reads).toBe(4)
    expect(waited).toEqual([5, 20, 60])
    expect(given.at(-1)).toEqual(unavailable(`fixture: HTTP 503. ${NOT_READ_AGAIN}`))
    // Only the last says so: the earlier failures are still being retried.
    expect(given.slice(0, -1)).toEqual([RETRYING, RETRYING, RETRYING])
  })

  it('gives nothing once aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { given, reads } = await run([FAILED, READ], [5], controller.signal)
    expect(given).toEqual([])
    expect(reads).toBe(1)
  })
})

describe('solSliderShown', () => {
  it('shows only off the welcome globe, with tools showing and no tool panel open', () => {
    expect(solSliderShown('close-up', false, null)).toBe(true)
    expect(solSliderShown('welcome', false, null)).toBe(false)
    expect(solSliderShown('close-up', true, null)).toBe(false)
    expect(solSliderShown('close-up', false, 'plan-walk')).toBe(false)
  })
})
