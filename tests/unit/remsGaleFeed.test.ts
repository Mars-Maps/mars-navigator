import { describe, expect, it } from 'vitest'
import {
  latestRemsRecord,
  loadRemsFeed,
  parseRemsFeed,
  REMS_FEED_CAVEAT,
  REMS_FEED_CITATION,
  REMS_FEED_URL,
  type RemsIo,
} from '../../src/data/temperature/remsGaleFeed'

// Test fixture only: three rows in the feed's shape, never shown in the app.
const row = (patch: Record<string, unknown> = {}) => ({
  id: '4746',
  terrestrial_date: '2026-08-25',
  sol: '4995',
  ls: '341',
  season: 'Month 12',
  min_temp: '-71',
  max_temp: '-5',
  pressure: '777',
  min_gts_temp: '-84',
  max_gts_temp: '4',
  ...patch,
})
const feed = (soles: unknown[]) => ({ descriptions: { disclaimer_en: 'outreach' }, soles })

describe('parseRemsFeed', () => {
  it('reads sol, date, Ls and the two ground temperatures as numbers', () => {
    expect(parseRemsFeed(feed([row()]))).toEqual([
      { sol: 4995, dateUtc: '2026-08-25', solarLongitudeDeg: 341, minGroundC: -84, maxGroundC: 4 },
    ])
  })

  it('a "--" or empty field is null, never 0', () => {
    const records = parseRemsFeed(feed([row({ min_gts_temp: '--', max_gts_temp: '', ls: '--' })]))
    expect(records).toEqual([{ sol: 4995, dateUtc: '2026-08-25', solarLongitudeDeg: null, minGroundC: null, maxGroundC: null }])
  })

  it('says what is wrong, naming the row, and never returns part of a feed', () => {
    expect(parseRemsFeed(null)).toBe('not a JSON object')
    expect(parseRemsFeed({})).toBe('no "soles" list')
    expect(parseRemsFeed(feed([]))).toBe('the "soles" list is empty')
    expect(parseRemsFeed(feed([row(), 'x']))).toBe('row 1: not an object')
    expect(parseRemsFeed(feed([row({ sol: '12.5' })]))).toMatch(/row 0: sol "12.5"/)
    expect(parseRemsFeed(feed([row({ terrestrial_date: '25/08/2026' })]))).toMatch(/not YYYY-MM-DD/)
    expect(parseRemsFeed(feed([row({ ls: '400' })]))).toMatch(/not a solar longitude/)
    expect(parseRemsFeed(feed([row({ min_gts_temp: 'cold' })]))).toMatch(/min_gts_temp "cold"/)
    expect(parseRemsFeed(feed([row({ max_gts_temp: '999' })]))).toMatch(/max_gts_temp "999"/)
    expect(parseRemsFeed(feed([row({ min_gts_temp: '10', max_gts_temp: '-10' })]))).toMatch(/above max_gts_temp/)
  })
})

describe('loadRemsFeed', () => {
  const live = () => new AbortController().signal

  it('is OFFICIAL with the citation, from the one feed URL', async () => {
    const urls: string[] = []
    const io: RemsIo = { fetchJson: async (url) => { urls.push(url); return feed([row(), row({ sol: '4994', terrestrial_date: '2026-08-24' })]) } }
    const result = await loadRemsFeed(live(), io)
    expect(urls).toEqual([REMS_FEED_URL])
    expect(REMS_FEED_URL).toMatch(/^https:\/\/mars\.nasa\.gov\/rss\/api\/\?feed=weather&category=msl/)
    expect(result.classification).toBe('OFFICIAL')
    if (result.classification !== 'OFFICIAL') return
    expect(result.source).toBe(REMS_FEED_CITATION)
    expect(result.value).toHaveLength(2)
  })

  it('is UNAVAILABLE with the reason when the fetch fails, the body is wrong, or the read was cancelled', async () => {
    const reason = async (io: RemsIo, signal = live()) => {
      const r = await loadRemsFeed(signal, io)
      return r.classification === 'UNAVAILABLE' ? r.reason : 'available'
    }
    expect(await reason({ fetchJson: async () => Promise.reject(new Error('HTTP 503')) })).toBe('Curiosity REMS feed failed to load: HTTP 503')
    expect(await reason({ fetchJson: async () => ({ soles: [{ sol: 'x' }] }) })).toMatch(/failed to load: row 0/)
    const aborted = new AbortController()
    aborted.abort()
    let asked = false
    expect(await reason({ fetchJson: async () => { asked = true; return feed([row()]) } }, aborted.signal)).toMatch(/cancelled/)
    expect(asked).toBe(false)
  })

  it('the caveat quotes the feed’s own disclaimer and names the unit', () => {
    expect(REMS_FEED_CAVEAT).toMatch(/intended for outreach purposes only/)
    expect(REMS_FEED_CAVEAT).toMatch(/°C/)
    expect(REMS_FEED_CITATION).toMatch(/Checked 2026-10-29/)
  })
})

describe('latestRemsRecord', () => {
  it('takes the highest sol whatever the order, and null for none', () => {
    const records = parseRemsFeed(feed([row({ sol: '10' }), row({ sol: '30' }), row({ sol: '20' })]))
    expect(typeof records === 'string' ? null : latestRemsRecord(records)?.sol).toBe(30)
    expect(latestRemsRecord([])).toBeNull()
  })
})
