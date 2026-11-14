import { Color, ShaderMaterial } from 'three'
import { OUTLINE_FALLBACK, OUTLINE_TOKEN, tokenColor } from './designTokens'
import { ROUTE_TRAIL_COLOR } from './pinColors'

/**
 * The route drawn as a trail of round dots: pale Mars-dust dots with
 * a dark rim, so it reads on bright and dark terrain alike. The rim is the
 * canvas token and nearly half the radius: the thin rim it had
 * vanished on the pale THEMIS greys and the geology map's pastels. One points
 * draw call; the shader shows every `uStride`-th point (see pathDotStride)
 * and hides points over the horizon.
 */

/** Dot diameter, CSS pixels. */
export const PATH_DOT_PX = 9
/** Pale dust, shared with the surface view's route line. */
const DOT_COLOR = ROUTE_TRAIL_COLOR
/** Where the rim starts, as a fraction of the dot's radius: a ring of about 2 px. */
const RIM_FROM = 0.55

const vertexShader = /* glsl */ `
  attribute float aIndex;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uStride;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 normal = normalize(mat3(modelMatrix) * position);
    float facing = dot(normal, normalize(cameraPosition - world.xyz));
    if (facing <= 0.0 || mod(aIndex, uStride) > 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_PointSize = uSize * uPixelRatio;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uRim;

  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    // The outer ring is the rim; a soft edge keeps the dot round when small.
    float edge = 1.0 - smoothstep(0.88, 1.0, r);
    vec3 color = r > ${RIM_FROM} ? uRim : uColor;
    gl_FragColor = vec4(color, edge);
    #include <colorspace_fragment>
  }
`

export function createPathDotMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uSize: { value: PATH_DOT_PX },
      uPixelRatio: { value: 1 },
      uStride: { value: 1 },
      uColor: { value: new Color(DOT_COLOR) },
      uRim: { value: new Color(tokenColor(OUTLINE_TOKEN, OUTLINE_FALLBACK)) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
}
