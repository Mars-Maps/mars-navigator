import type { GridLabel } from './gridLabelPlan'

/**
 * What the grid-label tracker inside the Canvas and the label elements
 * outside it share, as SiteLabel shares one element through a ref.
 * The tracker publishes a new label set only when the labelled lines change;
 * the elements are kept by label key, so a frame between a new set and
 * React's render never moves the wrong text.
 */
export class GridLabelBridge {
  labels: readonly GridLabel[] = []
  private show: ((labels: readonly GridLabel[]) => void) | null = null
  private stale = false
  private readonly elements = new Map<string, HTMLDivElement>()

  /** The elements' owner listens for label sets; returns the disconnect. */
  connect(show: (labels: readonly GridLabel[]) => void): () => void {
    this.show = show
    // A newly mounted owner has no labels yet: hand it the current set.
    this.stale = true
    return () => {
      if (this.show === show) this.show = null
    }
  }

  get connected(): boolean {
    return this.show !== null
  }

  /** True when the owner must be handed the set again though the lines did not change. */
  get needsLabels(): boolean {
    return this.stale
  }

  publish(labels: readonly GridLabel[]): void {
    this.labels = labels
    this.stale = false
    this.show?.(labels)
  }

  /** A label's element mounted; returns its cleanup. */
  attach(key: string, el: HTMLDivElement): () => void {
    this.elements.set(key, el)
    return () => {
      if (this.elements.get(key) === el) this.elements.delete(key)
    }
  }

  element(key: string): HTMLDivElement | null {
    return this.elements.get(key) ?? null
  }
}
