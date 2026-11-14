import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatMarsCoordinate, unavailable, type SurfacePoint } from '../../src/domain'
import { createEscapeLayers, type EscapeEvent } from '../../src/lib/escapeLayers'
import { cancelOnEscape } from '../../src/features/mission-ui/tools/cancelOnEscape'
import { MarkedPointsView } from '../../src/features/mission-ui/tools/MarkedPoints'
import { rightClickUnmarks } from '../../src/features/mission-ui/tools/markerRightClick'

// Test fixtures only: invented points and descriptions, never shown in the app.
const NAMED: SurfacePoint = {
  id: 'marker-1',
  coordinate: { latitude: -4.5, longitudeEast: 137.4 },
  elevationMeters: unavailable('fixture-reason'),
  label: 'fixture-description',
}
const UNNAMED: SurfacePoint = {
  id: 'marker-2',
  coordinate: { latitude: 18.65, longitudeEast: 226.2 },
  elevationMeters: unavailable('fixture-reason'),
}

const noop = () => undefined
const render = (markers: SurfacePoint[]) =>
  renderToStaticMarkup(
    <MarkedPointsView markers={markers} onGoTo={noop} onSetPoint={noop} onUnmark={noop} onDescribe={noop} />,
  )

describe('MarkedPointsView', () => {
  it('says how to mark a point when there are none, with no count and no rows', () => {
    const html = render([])
    expect(html).toContain('No marked points. Right-click the surface and choose Mark point.')
    expect(html).not.toContain('<li')
    expect(html).not.toContain(' · ')
  })

  it('lists every marker in order with its count', () => {
    const html = render([NAMED, UNNAMED])
    expect(html).toContain(' · 2')
    expect(html.indexOf('fixture-description')).toBeLessThan(html.indexOf('Unnamed point'))
    expect(html.match(/<li/g)).toHaveLength(2)
  })

  it('shows the description, or "Unnamed point" when there is none', () => {
    expect(render([NAMED])).toContain('fixture-description')
    expect(render([UNNAMED])).toContain('Unnamed point')
  })

  it('shows each coordinate in the one display format', () => {
    const html = render([NAMED, UNNAMED])
    expect(html).toContain(formatMarsCoordinate(NAMED.coordinate))
    expect(html).toContain(formatMarsCoordinate(UNNAMED.coordinate))
  })

  it('names each row action after its point, for screen readers', () => {
    const html = render([NAMED, UNNAMED])
    for (const action of ['Go to', 'Set point at', 'Edit description of', 'Unmark']) {
      expect(html).toContain(`aria-label="${action} fixture-description"`)
      expect(html).toContain(`aria-label="${action} Unnamed point"`)
    }
  })

  // Leaving the editor sends focus to `[data-marker=id] [data-focus=edit-description]`.
  it("marks each row and only its Edit as where focus returns after editing", () => {
    const html = render([NAMED, UNNAMED])
    for (const marker of [NAMED, UNNAMED]) {
      const name = marker.label ?? 'Unnamed point'
      const row = html.match(new RegExp(`<li[^>]*data-marker="${marker.id}"[^>]*>.*?</li>`))?.[0]
      expect(row).toMatch(new RegExp(`aria-label="Edit description of ${name}" data-focus="edit-description"`))
    }
    expect(html.match(/data-focus="edit-description"/g)).toHaveLength(2)
  })

  it('without unmark and describe handlers, shows Go to only: no button that cannot work', () => {
    const html = renderToStaticMarkup(<MarkedPointsView markers={[NAMED, UNNAMED]} onGoTo={noop} />)
    expect(html).toContain('aria-label="Go to fixture-description"')
    expect(html).toContain('aria-label="Go to Unnamed point"')
    expect(html).not.toContain('Set point')
    expect(html).not.toContain('Edit description of')
    expect(html).not.toContain('Unmark')
    // Two Go to buttons and the title bar's minimise button.
    expect(html.match(/<button/g)).toHaveLength(3)
    expect(html.match(/aria-label="Go to /g)).toHaveLength(2)
  })

  it('shows a description as text, never as markup', () => {
    const html = render([{ ...NAMED, label: '<b>fixture</b>' }])
    expect(html).not.toContain('<b>fixture</b>')
    expect(html).toContain('&lt;b&gt;fixture&lt;/b&gt;')
  })
})

describe('rightClickUnmarks', () => {
  // Stands in for the clicked element: `closest` finds a control only when
  // the click is on or inside one.
  const target = (onControl: boolean) => ({
    closest: (selector: string) => (onControl && selector.includes('button') ? {} : null),
  })

  it('unmarks on a right-click on the row itself', () => {
    expect(rightClickUnmarks(target(false), false)).toBe(true)
  })

  it('never unmarks the row being edited, so a right-click to paste is safe', () => {
    expect(rightClickUnmarks(target(false), true)).toBe(false)
    expect(rightClickUnmarks(target(true), true)).toBe(false)
  })

  it('leaves a right-click on a control (Go to, Edit, Unmark, a field) alone', () => {
    expect(rightClickUnmarks(target(true), false)).toBe(false)
  })

  it('checks every control kind the row can hold', () => {
    const asked: string[] = []
    rightClickUnmarks({ closest: (s: string) => (asked.push(s), null) }, false)
    for (const tag of ['button', 'input', 'textarea', 'form']) expect(asked[0]).toContain(tag)
  })

  it('unmarks when the target is not an element', () => {
    expect(rightClickUnmarks(null, false)).toBe(true)
  })
})

describe('cancelOnEscape', () => {
  const press = (key: string): EscapeEvent => {
    const e = {
      key,
      defaultPrevented: false,
      preventDefault() {
        e.defaultPrevented = true
      },
    }
    return e
  }

  // The form's handler runs first, as React's does, then the window's
  // shared Escape rule with the menu or tool as its top layer.
  const run = (key: string) => {
    const layers = createEscapeLayers()
    const events: string[] = []
    layers.push(() => events.push('menu closed'))
    const e = press(key)
    cancelOnEscape(() => events.push('edit cancelled'))(e)
    layers.handle(e)
    return events
  }

  it('cancels the edit and leaves the menu or tool around it open', () => {
    expect(run('Escape')).toEqual(['edit cancelled'])
  })

  it('leaves every other key alone', () => {
    for (const key of ['Enter', 'Tab', ' ', 'a', 'ArrowDown']) expect(run(key)).toEqual([])
  })
})
