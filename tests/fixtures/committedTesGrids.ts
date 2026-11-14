import { readFileSync } from 'node:fs'
import { loadTesThermalGrids, type BytesIo, type TesThermalGrids } from '../../src/data/adapters/ThermalGridAdapter'

/**
 * The committed TES grids read from disk, for tests that need the
 * official thermal inertia and albedo at a point without a browser: the
 * adapter asks for each file by its bundled URL, and this serves it by
 * name from `src/data/thermal/`.
 */
const onDisk: BytesIo = {
  fetchBytes: async (url) => {
    const name = url.split('/').pop()?.split('?')[0] ?? ''
    const b = readFileSync(`src/data/thermal/${name}`)
    // A Buffer's backing store is typed ArrayBufferLike; a fresh slice of it is a plain ArrayBuffer.
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  },
}

export function readCommittedTesGrids(): Promise<TesThermalGrids> {
  return loadTesThermalGrids(new AbortController().signal, onDisk)
}
