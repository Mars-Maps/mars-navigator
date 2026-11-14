import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppLayout, SIMULATED_ON_SCREEN } from '../../src/app/layout/AppLayout'

describe('the corner label', () => {
  const html = renderToStaticMarkup(<AppLayout panels={{}} />)

  it('names what is invented on every screen, in the simulated colour', () => {
    expect(html).toContain('text-simulated')
    expect(html).toMatch(/Simulated: [^<]*spin speed/)
    expect(SIMULATED_ON_SCREEN).toContain('surface view')
  })

  it('no longer says the whole app has no official data', () => {
    expect(html).not.toContain('no official dataset')
  })
})
