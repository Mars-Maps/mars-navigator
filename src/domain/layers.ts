import type { DataClassification } from './classification'

/** The four base map layers. */
export type MapLayerId = 'satellite' | 'elevation' | 'thermal' | 'geology'

/**
 * The layer shown, greyed, wherever another layer has no data:
 * the only one that is global, opaque and a picture of the surface.
 * Named here so the globe and the layer menu agree on it.
 */
export const BASE_MAP_LAYER_ID: MapLayerId = 'satellite'

/**
 * A base map layer. Every layer must say where it came from and under what
 * licence before it is shown.
 */
export interface MapLayer {
  id: MapLayerId
  /** Human-readable, for the layer menu. */
  label: string
  /** A layer we show always has a source, so it is never UNAVAILABLE. */
  classification: Exclude<DataClassification, 'UNAVAILABLE'>
  /** Source URL or citation. */
  source: string
  /** Licence and attribution note. */
  licence: string
  /**
   * Who serves the layer, for the caption's provenance line: "NASA Mars
   * Trek" for the tile layers, the archive for a grid drawn from a
   * committed dataset.
   */
  provider: string
  /**
   * What the picture is NOT, shown beside the layer whenever set
   *: e.g. "Colourized Viking mosaic, not true colour" or
   * "Elevation-coded colour, not surface colour". `null` means the layer
   * shows what it appears to show. Required, not optional, so forgetting the
   * caption is a type error and leaving it out is an explicit choice. See
   * DATA_SOURCES.md, layer table.
   */
  caveat: string | null
  /**
   * A small image of what the layer looks like, for pickers. The same
   * official imagery as the layer itself, so it needs no label of its own;
   * null when the source offers none, and a picker shows an empty tile.
   */
  previewUrl: string | null
  /**
   * What the layer's colours mean, from the product's own documentation.
   * Required, like `caveat`, so a layer without one is a type error
   * and "no legend" is a stated, cited reason, never an omission.
   */
  legend: MapLayerLegend
}

/**
 * A layer's legend. Never derived by sampling colours: a `scale` is copied
 * from the source's published colour scale, a `categories` legend is read
 * from the producer's own legend service at runtime, a `ramp` is a
 * colour scale this project drew itself over a dataset's values and says
 * so, and a layer whose source publishes none is `none` with the
 * reason.
 */
export type MapLayerLegend =
  | {
      kind: 'ramp'
      /** What the numbers are, as the source words it. */
      quantity: string
      /** The unit the stops are in, as written in the legend. */
      unit: string
      /**
       * The colour stops, low to high; values under the first or over the
       * last take its colour, and the legend shows the ends as "under" and
       * "over". Colours are CSS hex, `#rrggbb`.
       */
      stops: { value: number; color: string }[]
      /** OFFICIAL when the values are the dataset's; DERIVED when a model made them (the method in `source`). */
      classification: 'OFFICIAL' | 'DERIVED'
      /** The dataset's citation, or the model's method. */
      source: string
      /** That the colours are the project's choice, and what the no-data gaps mean. */
      note: string
    }
  | {
      kind: 'scale'
      min: number
      max: number
      /** Labelled points on the scale, inside min..max, e.g. 0.1 "Detection limit". */
      marks: { value: number; label: string }[]
      /** What the numbers are, as the source words it. */
      quantity: string
      /** The official colour bar, linked to where its producer serves it. */
      imageUrl: string
      /** Citation for the scale. */
      source: string
    }
  | {
      kind: 'categories'
      /** What the colours stand for, as the source words it. */
      quantity: string
      /**
       * The producer's legend service, which the adapter reads into
       * `LegendEntry`s: names and swatches as published, never typed in here.
       */
      legendUrl: string
      /** The map sheet and pamphlet, for the reader. */
      publicationUrl: string
      /** Citation for the legend. */
      source: string
    }
  | { kind: 'none'; reason: string }

/** One named class in a categorical legend, with the producer's own swatch. */
export interface LegendEntry {
  label: string
  /** The swatch image as the producer serves it (a data: or https: URL). */
  swatchUrl: string
}
