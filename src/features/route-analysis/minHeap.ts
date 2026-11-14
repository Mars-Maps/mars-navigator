/** A binary min-heap of node indices by priority. Stale entries are skipped by the caller's closed set. */
export class MinHeap {
  private readonly keys: number[] = []
  private readonly prio: number[] = []

  get size(): number {
    return this.keys.length
  }

  push(key: number, priority: number): void {
    const { keys, prio } = this
    let i = keys.push(key) - 1
    prio.push(priority)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (prio[parent] <= prio[i]) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): number {
    const { keys, prio } = this
    const top = keys[0]
    // Callers pop only while `size > 0`, so both arrays have a last element.
    const lastKey = keys.pop() as number
    const lastPrio = prio.pop() as number
    if (keys.length > 0) {
      keys[0] = lastKey
      prio[0] = lastPrio
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let least = i
        if (l < keys.length && prio[l] < prio[least]) least = l
        if (r < keys.length && prio[r] < prio[least]) least = r
        if (least === i) break
        this.swap(i, least)
        i = least
      }
    }
    return top
  }

  private swap(i: number, j: number): void {
    const { keys, prio } = this
    ;[keys[i], keys[j]] = [keys[j], keys[i]]
    ;[prio[i], prio[j]] = [prio[j], prio[i]]
  }
}
