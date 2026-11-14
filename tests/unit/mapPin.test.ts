import { describe, expect, it } from 'vitest'
import { InstancedBufferAttribute } from 'three'
import { createPinGeometry } from '../../src/features/mars-3d/mapPin'

describe('createPinGeometry', () => {
  it('instances one quad per pin, centred on the tip', () => {
    const tips = new Float32Array([1, 0, 0, 0, 1, 0])
    const colors = new Float32Array([1, 0, 0, 0, 0, 1])
    const geometry = createPinGeometry(tips, colors)

    expect(geometry.instanceCount).toBe(2)
    expect(geometry.getIndex()?.count).toBe(6)
    const corners = geometry.getAttribute('position')
    expect(corners.count).toBe(4)
    let sumX = 0
    let sumY = 0
    for (let i = 0; i < corners.count; i++) {
      expect(Math.abs(corners.getX(i))).toBe(1)
      expect(Math.abs(corners.getY(i))).toBe(1)
      sumX += corners.getX(i)
      sumY += corners.getY(i)
    }
    expect([sumX, sumY]).toEqual([0, 0])
  })

  it('makes every per-pin attribute instanced, at rest', () => {
    const geometry = createPinGeometry(new Float32Array(9), new Float32Array(9))
    for (const name of ['aTip', 'aColor', 'aScale', 'aAngle']) {
      const attribute = geometry.getAttribute(name)
      expect(attribute).toBeInstanceOf(InstancedBufferAttribute)
      expect(attribute.count).toBe(3)
    }
    expect(Array.from(geometry.getAttribute('aScale').array)).toEqual([1, 1, 1])
    expect(Array.from(geometry.getAttribute('aAngle').array)).toEqual([0, 0, 0])
  })

  it('draws nothing with no pins', () => {
    const geometry = createPinGeometry(new Float32Array(0), new Float32Array(0))
    expect(geometry.instanceCount).toBe(0)
  })
})
