import {
  BufferAttribute,
  CanvasTexture,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  Vector2,
  type Texture,
} from 'three'
import { OUTLINE_FALLBACK, OUTLINE_TOKEN, tokenColor } from './designTokens'

/**
 * The map-pin marker: a teardrop pin drawn once into a texture, and an
 * instanced shader that draws every pin in one call with its own colour,
 * size and swing.
 *
 * Each pin is a screen-facing quad built in the vertex shader, not a
 * point sprite: WebGL drops a whole point when its centre leaves the view,
 * but clips a quad per pixel, so a pin stays drawn while any of it is on
 * screen.
 *
 * The pin's tip is the centre of the quad, so the tip sits exactly on the
 * coordinate and the swing pivots there. The pin fills the top half; the
 * bottom half is transparent.
 */

/** Sprite square, CSS pixels; the pin itself is the top half. */
export const PIN_SPRITE_PX = 56

const TEX = 128
const TIP_Y = TEX / 2 - 3
const HEAD_Y = 28
const HEAD_R = 18
/** Rim and halo, texture pixels (128 px = 56 CSS px): about 2.6 and 2.6 CSS px. */
const RIM_PX = 6
const HALO_PX = 6
const DOT_R = 6

/**
 * White pin, dark rim, dark centre dot, and a soft dark halo outside the
 * rim, so a pin reads on the pale and grey layers as well as the
 * dark ones. The shader multiplies by the pin's colour, so the body takes
 * the colour and the rim, dot and halo stay dark. Rim and halo are the
 * canvas token.
 */
export function createPinTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = TEX
  canvas.height = TEX
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const cx = TEX / 2
    // Tangents from the tip to the head circle, so the sides meet it smoothly.
    const beta = Math.acos(HEAD_R / (TIP_Y - HEAD_Y))
    const outline = tokenColor(OUTLINE_TOKEN, OUTLINE_FALLBACK)
    ctx.beginPath()
    ctx.moveTo(cx, TIP_Y)
    ctx.arc(cx, HEAD_Y, HEAD_R, Math.PI / 2 + beta, Math.PI / 2 - beta)
    ctx.closePath()
    // The rim casts the halo; the body is filled over it without one.
    ctx.lineWidth = RIM_PX
    ctx.lineJoin = 'round'
    ctx.strokeStyle = outline
    ctx.shadowColor = outline
    ctx.shadowBlur = HALO_PX
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, HEAD_Y, DOT_R, 0, Math.PI * 2)
    ctx.fillStyle = outline
    ctx.fill()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** Quad corners, -1..1, y up; corner (0, 0) would be the tip. */
const QUAD_CORNERS = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]
const QUAD_INDEX = [0, 1, 2, 0, 2, 3]

/**
 * One quad instanced per pin. `tips` and `colors` hold three floats per pin:
 * the tip in the globe's local frame, and the linear colour. `aScale` starts
 * at 1 and `aAngle` at 0; the frame loop animates both.
 */
export function createPinGeometry(tips: Float32Array, colors: Float32Array): InstancedBufferGeometry {
  const count = tips.length / 3
  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(QUAD_CORNERS), 3))
  geometry.setIndex(QUAD_INDEX)
  geometry.setAttribute('aTip', new InstancedBufferAttribute(tips, 3))
  geometry.setAttribute('aColor', new InstancedBufferAttribute(colors, 3))
  geometry.setAttribute('aScale', new InstancedBufferAttribute(new Float32Array(count).fill(1), 1))
  geometry.setAttribute('aAngle', new InstancedBufferAttribute(new Float32Array(count), 1))
  geometry.instanceCount = count
  return geometry
}

const vertexShader = /* glsl */ `
  attribute vec3 aTip;
  attribute vec3 aColor;
  attribute float aScale;
  attribute float aAngle;
  uniform float uSize;
  uniform vec2 uViewport;
  varying vec3 vColor;
  varying vec2 vUv;

  void main() {
    vColor = aColor;
    vUv = position.xy * 0.5 + 0.5;
    vec4 world = modelMatrix * vec4(aTip, 1.0);
    // Tips are relative to the globe's centre, so they are also the surface
    // normal. Pins over the horizon are not drawn: depth testing would clip
    // a tall pin against the near surface instead.
    vec3 normal = normalize(mat3(modelMatrix) * aTip);
    float facing = dot(normal, normalize(cameraPosition - world.xyz));
    if (facing <= 0.0 || aScale <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // Swing about the tip, then offset the corner in screen pixels.
    float c = cos(aAngle);
    float s = sin(aAngle);
    vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
    vec2 ndc = corner * uSize * aScale / uViewport;
    vec4 clip = projectionMatrix * viewMatrix * world;
    clip.xy += ndc * clip.w;
    gl_Position = clip;
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying vec2 vUv;

  void main() {
    vec4 texel = texture2D(uMap, vUv);
    if (texel.a < 0.05) discard;
    gl_FragColor = vec4(texel.rgb * vColor, texel.a);
    #include <colorspace_fragment>
  }
`

/**
 * For `createPinGeometry`. Drawn over the surface without depth testing;
 * the vertex shader hides pins on the far side instead. Set `uViewport` to
 * the canvas size in CSS pixels every frame, or pins are sized for 1 × 1.
 */
export function createPinMaterial(map: Texture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uSize: { value: PIN_SPRITE_PX },
      uViewport: { value: new Vector2(1, 1) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
}
