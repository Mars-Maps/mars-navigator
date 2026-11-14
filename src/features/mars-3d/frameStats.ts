/**
 * Frame-time statistics for the performance probe. A fixed ring of
 * the most recent samples, so recording allocates nothing per frame. Pure,
 * so it is testable without WebGL; the component is PerfProbe.tsx.
 */

export interface FrameSummary {
  count: number
  meanMs: number
  /** Nearest-rank 95th percentile: 1 frame in 20 is slower than this. */
  p95Ms: number
  maxMs: number
  /** 1000 / mean. */
  fps: number
}

export class FrameSampler {
  private readonly samples: Float64Array
  private readonly sorted: Float64Array
  private next = 0
  private filled = 0

  constructor(capacity = 300) {
    this.samples = new Float64Array(capacity)
    this.sorted = new Float64Array(capacity)
  }

  /** Non-finite or negative samples are dropped, not counted as zero. */
  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return
    this.samples[this.next] = ms
    this.next = (this.next + 1) % this.samples.length
    if (this.filled < this.samples.length) this.filled++
  }

  reset(): void {
    this.next = 0
    this.filled = 0
  }

  /** Null until a sample exists: no frames is not a frame time of zero. */
  summary(): FrameSummary | null {
    const n = this.filled
    if (n === 0) return null
    const view = this.sorted.subarray(0, n)
    view.set(this.samples.subarray(0, n))
    view.sort()
    let sum = 0
    for (let i = 0; i < n; i++) sum += view[i]
    const meanMs = sum / n
    return {
      count: n,
      meanMs,
      p95Ms: view[Math.ceil(0.95 * n) - 1],
      maxMs: view[n - 1],
      fps: meanMs > 0 ? 1000 / meanMs : Infinity,
    }
  }
}
