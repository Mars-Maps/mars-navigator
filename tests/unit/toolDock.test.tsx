import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DOCK_MAX_SCALE,
  DOCK_REACH,
  dockScale,
  dockScales,
  restingOffset,
} from '../../src/features/mission-ui/tools/magnify'
import { PlaceholderPanel } from '../../src/features/mission-ui/tools/PlaceholderPanels'
import { findTool, TOOL_REGISTRY } from '../../src/features/mission-ui/tools/registry'
import { ToolDock, ToolPanel } from '../../src/features/mission-ui/tools/ToolDock'
import { SHELL_PANEL_TOOL_IDS, type ToolDefinition } from '../../src/features/mission-ui/tools/types'
import { nextToolbarIndex } from '../../src/features/mission-ui/tools/toolbarKeys'

/** No tool in the registry is unbuilt now; the notice still works for the next one. */
const UNBUILT_FIXTURE: ToolDefinition = { id: 'fixture', label: 'Fixture & Tool', hint: 'fixture', icon: null, notBuilt: 'not scheduled' }

describe('the map tools after Plan a walk', () => {
  it('are in the dock in order', () => {
    expect(TOOL_REGISTRY.map((tool) => tool.label)).toEqual([
      'Plan a walk',
      'Rover photos',
      'Measure',
      // One name with its panel and the menu's Mark point.
      'Marked points',
      'Terrain Profile',
      'Terrain Profile 3D',
      'Search & Go To',
    ])
  })

  it('each has its own body, one from the shell, or says it is not built: exactly one', () => {
    for (const tool of TOOL_REGISTRY) {
      const kinds = [tool.Panel, tool.panelFromShell, tool.notBuilt].filter(Boolean)
      expect(kinds, tool.id).toHaveLength(1)
    }
  })

  it.each(['terrain-profile', 'terrain-profile-3d'])('%s is built, with its panel from the shell', (id) => {
    const tool = TOOL_REGISTRY.find((t) => t.id === id)
    expect(tool?.panelFromShell).toBe(true)
    expect(tool?.notBuilt).toBeUndefined()
  })

  it('the shell-panel ids are exactly the tools marked panelFromShell', () => {
    const marked = TOOL_REGISTRY.filter((t) => t.panelFromShell).map((t) => t.id)
    expect(marked).toEqual([...SHELL_PANEL_TOOL_IDS])
  })
})

describe('dock magnification', () => {
  it('peaks under the cursor and is back to rest at the reach', () => {
    expect(dockScale(0)).toBe(DOCK_MAX_SCALE)
    expect(dockScale(DOCK_REACH)).toBe(1)
    expect(dockScale(-DOCK_REACH - 1)).toBe(1)
    expect(dockScale(Number.NaN)).toBe(1)
  })

  it('falls off smoothly and symmetrically', () => {
    let previous = dockScale(0)
    for (let d = 0.25; d <= DOCK_REACH; d += 0.25) {
      const scale = dockScale(d)
      expect(scale).toBeLessThan(previous)
      expect(dockScale(-d)).toBe(scale)
      previous = scale
    }
  })

  it('magnifies the button under the cursor most, measured on the resting layout', () => {
    const count = 8
    const scales = dockScales(restingOffset(2, count), count)
    expect(scales[2]).toBe(DOCK_MAX_SCALE)
    expect(Math.max(...scales)).toBe(scales[2])
    expect(scales[1]).toBeCloseTo(scales[3])
    expect(scales[7]).toBe(1)
  })

  it('leaves every button at rest with no cursor or focus', () => {
    expect(dockScales(null, 8)).toEqual(Array(8).fill(1))
  })
})

describe('dock keyboard', () => {
  it('arrows move and wrap; Home and End jump to the ends', () => {
    expect(nextToolbarIndex('ArrowRight', 0, 8)).toBe(1)
    expect(nextToolbarIndex('ArrowRight', 7, 8)).toBe(0)
    expect(nextToolbarIndex('ArrowLeft', 0, 8)).toBe(7)
    expect(nextToolbarIndex('Home', 5, 8)).toBe(0)
    expect(nextToolbarIndex('End', 2, 8)).toBe(7)
  })

  it('ignores other keys and an empty toolbar', () => {
    expect(nextToolbarIndex('Enter', 3, 8)).toBeNull()
    expect(nextToolbarIndex('ArrowRight', 0, 0)).toBeNull()
  })
})

describe('the dock as rendered', () => {
  // A server render reads the store's initial state: no active tool, no markers.
  const html = renderToStaticMarkup(<ToolDock />)

  it('renders seven buttons, Plan a walk, Rover photos and the five map tools, with exactly one Tab stop', () => {
    expect(html.match(/<button/g)).toHaveLength(7)
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
  })

  it('no button is disabled: every tool in the dock can be opened, Terrain Profile 3D at any count', () => {
    expect(html).not.toContain('aria-disabled')
    expect(html).toContain('Terrain Profile 3D')
  })

  it('an unbuilt tool opens a panel that carries its note and shows no value', () => {
    const panel = renderToStaticMarkup(
      <PlaceholderPanel title={UNBUILT_FIXTURE.label} note={UNBUILT_FIXTURE.notBuilt ?? ''} />,
    )
    expect(panel).toContain('Fixture &amp; Tool')
    expect(panel).toContain('Tool not built yet (not scheduled).')
    // No value of any kind: not a single digit in the panel's text.
    expect(panel.replace(/<[^>]*>/g, '')).not.toMatch(/\d/)
  })
})

describe('a panel the shell renders', () => {
  const shellPanel = <p>fixture shell panel</p>
  const tool = (id: string) => {
    const found = findTool(id)
    if (!found) throw new Error(`No tool "${id}" in the registry`)
    return found
  }

  it('is what opens for a tool whose panel comes from the shell', () => {
    const html = renderToStaticMarkup(
      <ToolPanel tool={tool('terrain-profile')} panels={{ 'terrain-profile': shellPanel }} />,
    )
    expect(html).toBe('<p>fixture shell panel</p>')
  })

  it('opens nothing, and no not-built notice, when the shell passes none', () => {
    expect(renderToStaticMarkup(<ToolPanel tool={tool('terrain-profile')} panels={{}} />)).toBe('')
  })

  it('never replaces the notice of a tool that is not built', () => {
    const unbuilt = { ...UNBUILT_FIXTURE, id: 'search' }
    const html = renderToStaticMarkup(<ToolPanel tool={unbuilt} panels={{ search: shellPanel }} />)
    expect(html).not.toContain('fixture shell panel')
    expect(html).toContain('Tool not built yet (not scheduled).')
  })

  it('never replaces the body of a built tool', () => {
    const html = renderToStaticMarkup(<ToolPanel tool={tool('measure')} panels={{ measure: shellPanel }} />)
    expect(html).not.toContain('fixture shell panel')
    expect(html).toContain('Measure')
  })
})
