/**
 * The drawing info of the USGS SIM 3464 feature service's Geologic Units
 * layer (layer 8), as it answered on 2026-11-03, cut to what the adapter
 * reads. OFFICIAL values copied verbatim: re-read it, do not retype it.
 */
const c = (value: string, r: number, g: number, b: number) => ({ value, symbol: { color: [r, g, b, 255] } })

export const SIM_3464_LAYER = {
  drawingInfo: {
    renderer: {
      type: 'uniqueValue',
      field1: 'unit',
      uniqueValueInfos: [
        c('7', 255, 255, 0),
        c('12', 102, 153, 0),
        c('13', 235, 235, 102),
        c('11', 179, 128, 77),
        c('4', 0, 0, 235),
        c('1', 0, 153, 255),
        c('0', 0, 77, 235),
        c('2', 235, 77, 128),
        c('3', 222, 77, 0),
        c('6', 235, 204, 153),
        c('5', 179, 0, 235),
        c('9', 235, 179, 255),
        c('10', 255, 179, 0),
        c('8', 204, 222, 153),
      ],
    },
  },
}
