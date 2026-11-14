import { runLayerCurves } from '../features/route-analysis/temperatureLayer'
import type { DiurnalInputs } from '../features/route-analysis/thermalModel'

/**
 * One slice of the temperature layer's model runs, off the main
 * thread so the globe keeps turning: the shell posts the inputs and a
 * range, this posts the sampled curves back, buffer transferred.
 */
export interface LayerCurvesRequest {
  inputs: DiurnalInputs[]
  from: number
  to: number
}

export interface LayerCurvesReply {
  from: number
  to: number
  curves: Float32Array
}

addEventListener('message', (event: MessageEvent<LayerCurvesRequest>) => {
  const { inputs, from, to } = event.data
  const curves = runLayerCurves(inputs, from, to)
  const reply: LayerCurvesReply = { from, to, curves }
  postMessage(reply, { transfer: [curves.buffer] })
})
