import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OverheadMapMenu } from '../../src/features/mars-3d/surfaceView/OverheadMapMenu'

const render = (decimals: number) =>
  renderToStaticMarkup(
    <OverheadMapMenu
      at={{ latitude: -4.5895, longitudeEast: 137.4417 }}
      decimals={decimals}
      x={10}
      y={20}
      width={192}
      onTeleport={() => {}}
      onCancel={() => {}}
    />,
  )

describe('OverheadMapMenu', () => {
  it('shows the picked coordinate as DERIVED and asks before teleporting', () => {
    const html = render(2)
    expect(html).toContain('4.59°S')
    expect(html).toContain('137.44°E')
    expect(html).toContain('DERIVED')
    expect(html).toContain('Teleport here?')
    expect(html).toContain('>Teleport here</button>')
    expect(html).toContain('>Cancel</button>')
  })

  it('keeps its keys from the walker and sits where the map put it', () => {
    const html = render(1)
    expect(html).toContain('data-own-keys')
    expect(html).toContain('left:10px')
    expect(html).toContain('top:20px')
  })
})
