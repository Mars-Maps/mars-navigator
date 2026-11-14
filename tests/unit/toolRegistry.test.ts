import { beforeEach, describe, expect, it } from 'vitest'
import {
  duplicateToolIds,
  nextActiveTool,
} from '../../src/features/mission-ui/tools/activation'
import { findTool, TOOL_REGISTRY } from '../../src/features/mission-ui/tools/registry'
import { useMissionStore } from '../../src/state'

describe('tool registry', () => {
  it('has unique ids, so one store value lights exactly one button', () => {
    expect(duplicateToolIds(TOOL_REGISTRY)).toEqual([])
    expect(TOOL_REGISTRY.length).toBeGreaterThanOrEqual(2)
  })

  it('findTool returns the entry, or null for no id or an unknown one', () => {
    const first = TOOL_REGISTRY[0]
    expect(findTool(first.id)).toBe(first)
    expect(findTool(null)).toBeNull()
    expect(findTool('not-a-tool')).toBeNull()
  })

  it('duplicateToolIds reports each repeated id once', () => {
    expect(duplicateToolIds([{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'a' }])).toEqual(['a'])
  })
})

describe('active tool', () => {
  beforeEach(() => {
    useMissionStore.setState({ activeToolId: null })
  })

  it('pressing a tool activates it; pressing it again releases it', () => {
    expect(nextActiveTool(null, 'flag')).toBe('flag')
    expect(nextActiveTool('flag', 'flag')).toBeNull()
  })

  it('pressing another tool replaces the active one, never two at once', () => {
    expect(nextActiveTool('flag', 'measure')).toBe('measure')
  })

  it('the store holds one id or null', () => {
    const { setActiveTool } = useMissionStore.getState()
    setActiveTool('flag')
    expect(useMissionStore.getState().activeToolId).toBe('flag')
    setActiveTool(nextActiveTool('flag', 'measure'))
    expect(useMissionStore.getState().activeToolId).toBe('measure')
    setActiveTool(null)
    expect(useMissionStore.getState().activeToolId).toBeNull()
  })
})
