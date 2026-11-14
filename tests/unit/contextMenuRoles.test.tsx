import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatMarsCoordinate, unavailable, type SurfacePoint } from '../../src/domain'
import { OpenMenu } from '../../src/features/mission-ui/ContextMenu'
import {
  ARROW_ITEMS,
  FIRST_ITEM,
  coordinateSource,
  nextItemIndex,
  stepOf,
  stepRoles,
} from '../../src/features/mission-ui/contextMenuStep'

describe('stepRoles', () => {
  it('is a menu named "Surface actions" while it shows only its items', () => {
    expect(stepRoles(stepOf(false, false))).toEqual({
      container: 'menu',
      label: 'Surface actions',
      describedByCoordinate: true,
      items: 'none',
    })
  })

  // The field is not a menu item, so the step is a dialog and the items
  // below the field form their own menu.
  it('is a dialog named for the step while the coordinate is edited', () => {
    const roles = stepRoles(stepOf(true, false))
    expect(roles.container).toBe('dialog')
    expect(roles.label).toBe('Edit coordinates')
    expect(roles.items).toBe('menu')
    // The coordinate line is the field itself while editing.
    expect(roles.describedByCoordinate).toBe(false)
  })

  it('is a dialog named for the step while a point is described', () => {
    const roles = stepRoles(stepOf(false, true))
    expect(roles.container).toBe('dialog')
    expect(roles.label).toBe('Mark point')
    expect(roles.describedByCoordinate).toBe(true)
  })

  it('treats describing as the step even if the editor flag is still set', () => {
    expect(stepOf(true, true)).toBe('describe')
  })
})

describe('nextItemIndex', () => {
  it('wraps the arrow keys and jumps with Home and End', () => {
    expect(nextItemIndex('ArrowDown', 6, 7)).toBe(0)
    expect(nextItemIndex('ArrowUp', 0, 7)).toBe(6)
    expect(nextItemIndex('Home', 4, 7)).toBe(0)
    expect(nextItemIndex('End', 1, 7)).toBe(6)
  })

  it('ignores other keys', () => {
    expect(nextItemIndex('a', 0, 7)).toBeNull()
  })

  // The description step has no items: its buttons keep their arrow keys.
  it('does nothing with no items', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(nextItemIndex(key, -1, 0)).toBeNull()
    }
  })
})

describe('ContextMenu markup', () => {
  const render = () =>
    renderToStaticMarkup(
      <OpenMenu
        menu={{ coordinate: { latitude: -4.5, longitudeEast: 137.4 }, anchor: { x: 10, y: 10 } }}
      />,
    )

  it('opens as a menu described by the coordinate', () => {
    const html = render()
    expect(html).toMatch(/^<div role="menu" aria-label="Surface actions" aria-describedby="context-menu-coordinate"/)
  })

  it('makes Edit a menu item, so the arrow keys reach it', () => {
    expect(render()).toMatch(/<button[^>]*role="menuitem"[^>]*aria-label="Edit coordinates"/)
  })

  // Edit comes first in the DOM; first focus skips it for the first action.
  it('gives first focus to Set point, not Edit', () => {
    expect(FIRST_ITEM).toContain('[data-item]')
    expect(render()).not.toMatch(/<button[^>]*aria-label="Edit coordinates"[^>]*data-item=/)
    const firstAction = render().match(/data-item="([^"]+)"/)?.[1]
    expect(firstAction).toBe('Set point')
  })

  it('leaves the items wrapper out of the tree while it is a menu', () => {
    expect(render()).toContain('<div role="none"><button')
  })
})

describe('ContextMenu near a marked point', () => {
  const menu = { coordinate: { latitude: -4.5, longitudeEast: 137.4 }, anchor: { x: 10, y: 10 } }
  const marker = (label?: string): SurfacePoint => ({
    id: 'marker-7',
    coordinate: { latitude: -4.5, longitudeEast: 137.4 },
    elevationMeters: unavailable('fixture'),
    ...(label ? { label } : {}),
  })
  const items = (html: string) => [...html.matchAll(/data-item="([^"]+)"/g)].map((m) => m[1])

  it('offers Unmark with the point\'s description, right after Set point', () => {
    const html = renderToStaticMarkup(<OpenMenu menu={menu} nearMarker={marker('Gale crater')} />)
    const list = items(html)
    expect(list[list.indexOf('Set point') + 1]).toBe('Unmark Gale crater')
    expect(html).toMatch(/<button[^>]*role="menuitem"[^>]*data-item="Unmark Gale crater"/)
  })

  it('names an undescribed point as the Marked points list does', () => {
    expect(items(renderToStaticMarkup(<OpenMenu menu={menu} nearMarker={marker()} />))).toContain(
      'Unmark Unnamed point',
    )
  })

  // The pick lands on the pin, above the surface, so its coordinate is off the point's.
  it('acts on the marked point, not the spot on its pin, and names it', () => {
    const onPin = { ...menu, coordinate: { latitude: 0.5, longitudeEast: 358.4 } }
    const html = renderToStaticMarkup(<OpenMenu menu={onPin} nearMarker={marker('Gale crater')} />)
    expect(html).toContain(formatMarsCoordinate(marker().coordinate))
    expect(html).not.toContain(formatMarsCoordinate(onPin.coordinate))
    expect(html).toMatch(/<p[^>]*>Gale crater<\/p>/)
    expect(html).not.toMatch(/>Coordinates</)
  })

  it('does not offer to mark a point already marked, and does elsewhere', () => {
    expect(items(renderToStaticMarkup(<OpenMenu menu={menu} nearMarker={marker()} />))).not.toContain('Mark point')
    expect(items(renderToStaticMarkup(<OpenMenu menu={menu} />))).toContain('Mark point')
  })

  it('calls only a right-clicked surface point a pick: a mark may have been typed', () => {
    expect(coordinateSource(true, false)).toBe('pick')
    expect(coordinateSource(true, true)).toBe('typed')
    expect(coordinateSource(false, false)).toBe('typed')
    expect(coordinateSource(false, true)).toBe('typed')
  })

  it('heads the line Coordinates when nothing is near', () => {
    expect(renderToStaticMarkup(<OpenMenu menu={menu} />)).toMatch(/>Coordinates</)
  })

  it('has no Unmark item when nothing is near', () => {
    expect(items(renderToStaticMarkup(<OpenMenu menu={menu} />)).some((l) => l.startsWith('Unmark'))).toBe(
      false,
    )
  })
})

describe('ContextMenu Set point in navigation', () => {
  const menu = { coordinate: { latitude: 18.45, longitudeEast: 77.45 }, anchor: { x: 10, y: 10 } }
  const setPointButton = (html: string) => html.match(/<button[^>]*data-item="Set point"[^>]*>.*?<\/button>/)?.[0] ?? ''
  // The opening tag of the first action item that is neither disabled nor off.
  const firstAction = (html: string) =>
    html
      .match(/<button[^>]*data-item="[^"]+"[^>]*>/g)
      ?.find((b) => !b.includes('disabled=""') && !b.includes('aria-disabled="true"'))

  it('stays in place, off, with the reason, while navigating', () => {
    const html = renderToStaticMarkup(<OpenMenu menu={menu} navigating />)
    const button = setPointButton(html)
    expect(button).toMatch(/aria-disabled="true"/)
    expect(button).toContain('End navigation to set a point')
    // Still the first item, so the menu keeps its shape.
    expect(html.match(/data-item="([^"]+)"/)?.[1]).toBe('Set point')
  })

  // Keyboard and screen-reader users reach it with the arrow keys and hear
  // the reason with the label: it is in the button, so in its name.
  it('keeps it focusable and in the arrow-key order while navigating', () => {
    const button = setPointButton(renderToStaticMarkup(<OpenMenu menu={menu} navigating />))
    expect(button).not.toMatch(/ disabled=""/)
    expect(ARROW_ITEMS).toContain(':not(:disabled)')
    expect(ARROW_ITEMS).not.toContain('aria-disabled')
  })

  it('leaves first focus to the next item while navigating', () => {
    expect(FIRST_ITEM).toContain(':not([aria-disabled="true"])')
    expect(firstAction(renderToStaticMarkup(<OpenMenu menu={menu} navigating />))).toContain('data-item="Mark point"')
  })

  it('is on, with no reason, in close-up', () => {
    const button = setPointButton(renderToStaticMarkup(<OpenMenu menu={menu} />))
    expect(button).not.toMatch(/disabled=/)
    expect(button).not.toContain('End navigation')
  })})
