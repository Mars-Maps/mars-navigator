import { describe, expect, it } from 'vitest'
import { shareRead } from '../../src/app/roverFeed'
import { official, unavailable, type Classified } from '../../src/domain'

// Test fixtures only: invented answers, never shown in the app.
const READ = official('version 1', 'fixture')
const FAILED = unavailable<string>('fixture: HTTP 503')
const live = () => new AbortController().signal

/** A read settled by hand, counting its requests and keeping the signal each was given. */
function handRead() {
  const settle: ((a: Classified<string>) => void)[] = []
  const signals: AbortSignal[] = []
  const read = shareRead<string>((signal) => {
    signals.push(signal)
    return new Promise((resolve) => settle.push(resolve))
  })
  return { read, settle, signals }
}

describe('shareRead', () => {
  it('makes one request for readers at the same time, and all get the same answer', async () => {
    const { read, settle } = handRead()
    const answers = Promise.all([read(live()), read(live())])
    expect(settle).toHaveLength(1)
    settle[0](READ)
    expect(await answers).toEqual([READ, READ])
  })

  it('keeps an answer with a value: a later reader makes no request', async () => {
    const { read, settle } = handRead()
    const first = read(live())
    settle[0](READ)
    await first
    expect(await read(live())).toBe(READ)
    expect(settle).toHaveLength(1)
  })

  it('does not keep a failure: waiting readers get it, the next reader asks again', async () => {
    const { read, settle } = handRead()
    const waiting = Promise.all([read(live()), read(live())])
    settle[0](FAILED)
    expect(await waiting).toEqual([FAILED, FAILED])

    const again = read(live())
    expect(settle).toHaveLength(2)
    settle[1](READ)
    expect(await again).toBe(READ)
  })

  it('answers a read that rejects as UNAVAILABLE with the reason, and tries again next time', async () => {
    let requests = 0
    const read = shareRead<string>(() => {
      requests++
      return Promise.reject(new Error('fixture: offline'))
    })
    expect(await read(live())).toEqual(unavailable('fixture: offline'))
    await read(live())
    expect(requests).toBe(2)
  })

  it('lets one reader leave without ending the read for another', async () => {
    const { read, settle, signals } = handRead()
    const leaving = new AbortController()
    const left = read(leaving.signal)
    const staying = read(live())

    leaving.abort()
    expect((await left).classification).toBe('UNAVAILABLE')
    expect(signals[0].aborted).toBe(false)

    settle[0](READ)
    expect(await staying).toBe(READ)
  })

  it('keeps the answer for the next reader even when every reader left before it came', async () => {
    const { read, settle } = handRead()
    const leaving = new AbortController()
    const left = read(leaving.signal)
    leaving.abort()
    await left
    settle[0](READ)
    // A whole task, so the request has ended and the next reader cannot simply join it.
    await new Promise((resolve) => setTimeout(resolve))
    expect(await read(live())).toBe(READ)
    expect(settle).toHaveLength(1)
  })

  it('makes no request for a reader already aborted', async () => {
    const { read, settle } = handRead()
    const gone = new AbortController()
    gone.abort()
    expect((await read(gone.signal)).classification).toBe('UNAVAILABLE')
    expect(settle).toHaveLength(0)
  })
})
