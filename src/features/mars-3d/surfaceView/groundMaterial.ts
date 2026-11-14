import { ShaderChunk, type Texture, type Vector2, type WebGLProgramParametersWithUniforms } from 'three'
import type { NearUniforms } from './useNearField'

/**
 * The ground's Lambert material, extended (SIMULATED appearance, labelled
 * in the view):
 *
 * - the bump grain fades out with distance from the eye, so it never
 *   stripes at grazing angles or tiles visibly from the air;
 * - the detail texture (groundDetail.ts) is sampled in world metres at four
 *   scales and multiplied into the imagery's colour around 1, so the real
 *   imagery still sets the colour at large scale while the ground gains
 *   grit, pebbles, patches and broad mottling at scales it cannot resolve;
 * - steeper ground is a little darker and rockier, flat ground a little
 *   dustier.
 *
 * Fine scales fade out with distance, which with mipmapping keeps the far
 * ground calm. One tile repeated in a grid reads as a grid, so each
 * scale is drawn as a blend of two copies of the tile at different offsets,
 * the pair picked by a slowly varying index from the next coarser scale
 * (Quilez's "texture repetition"): neighbouring repeats never show the
 * same picture.
 *
 * Where the near-field image (useNearField) has pixels, its detail
 * finer than the patch image's 20 m pixels is added to the patch's
 * brightness (the image less its own 20 m average, from a coarse mip
 * level), through the luminosity blend the patch image is composed with
 * (patchImage.ts); the 20 m tones stay the patch's. The detail fades out
 * as a screen pixel comes to span 2^4.5 to 2^6 of the image's pixels (on
 * foot, from about 100 m), since past that the image sampled no longer
 * holds it. Where the image shows, the simulated texture at the metre
 * scales it resolves is left off; it averages about 1, so the ground's
 * brightness does not change at the block's edge. The simulated scales of
 * 190 m and up, the dust, slope tint and grit stay.
 */

/**
 * The near-field image's mip level whose texels are the patch image's 20 m
 * pixels: 2^6 = 64 of HiRISE's 0.32 m pixels (useNearField, patchImage.ts).
 */
const NEAR_MEAN_LOD = 6

/** The grain fades out over this distance from the eye, metres. */
export const GRAIN_REACH_M = 60

const FADED_BUMP_CHUNK = ShaderChunk.bumpmap_pars_fragment
  .replace(
    'uniform float bumpScale;',
    `uniform float bumpScale;
  float grainFade() { return clamp(1.0 - length(vViewPosition) / ${GRAIN_REACH_M.toFixed(1)}, 0.0, 1.0); }`,
  )
  .replaceAll('bumpScale *', 'bumpScale * grainFade() *')

const VERTEX_DECLARATIONS = `
varying vec3 vGroundPos;
varying vec3 vGroundNormal;
`

const VERTEX_BODY = `
vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vGroundNormal = normalize(mat3(modelMatrix) * objectNormal);
`

const FRAGMENT_DECLARATIONS = `
varying vec3 vGroundPos;
varying vec3 vGroundNormal;
uniform sampler2D uDetail;
uniform vec2 uOrigin;
uniform sampler2D uNear;
uniform vec3 uNearU;
uniform vec3 uNearV;
uniform float uNearOn;

// The canvas's 'luminosity' blend (W3C Compositing, SetLum and ClipColor):
// c's hue and saturation with brightness l. In sRGB values, as on the canvas.
vec3 withLum(vec3 c, float l) {
  c += l - dot(c, vec3(0.3, 0.59, 0.11));
  float lum = dot(c, vec3(0.3, 0.59, 0.11));
  float lo = min(min(c.r, c.g), c.b);
  float hi = max(max(c.r, c.g), c.b);
  if (lo < 0.0) c = lum + (c - lum) * lum / max(lum - lo, 1e-5);
  if (hi > 1.0) c = lum + (c - lum) * (1.0 - lum) / max(hi - lum, 1e-5);
  return c;
}

// The detail tile at uv without a visible repeat: two copies at
// different offsets, blended. k (0–1, varying slowly over a few tiles)
// picks the pair, and as it crosses to the next pair the previous second
// copy becomes the first, so the blend is continuous. The plain lookup's
// derivatives keep its mipmapping, offsets or not.
vec4 untiled(vec2 uv, float k) {
  float index = k * 8.0;
  float i = floor(index);
  float f = fract(index);
  vec2 offsetA = sin(vec2(3.0, 7.0) * i);
  vec2 offsetB = sin(vec2(3.0, 7.0) * (i + 1.0));
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  vec4 a = textureGrad(uDetail, uv + offsetA, dx, dy);
  vec4 b = textureGrad(uDetail, uv + offsetB, dx, dy);
  // The crossover leans towards whichever copy has more in it, so it is not a straight band.
  float contrast = dot(a - b, vec4(0.25));
  return mix(a, b, smoothstep(0.2, 0.8, f - 0.1 * contrast));
}
`

const FRAGMENT_NEAR = `
// How much of this pixel the near-field image sets, 0–1; the detail below reads it.
float nearW = 0.0;
{
  vec3 g = vec3(vGroundPos.x, -vGroundPos.z, 1.0);
  vec2 nuv = vec2(dot(uNearU, g), dot(uNearV, g));
  // Sampled outside any branch, so its mipmapping has derivatives.
  vec2 at = clamp(nuv, 0.0, 1.0);
  vec4 hi = texture2D(uNear, at);
  vec4 mean = textureLod(uNear, at, ${NEAR_MEAN_LOD.toFixed(1)});
  // The mip level the hardware reads 'hi' from, roughly: past the mean's,
  // hi is coarser than mean and their difference would invert the 20 m tones,
  // so the image hands back to the ground's own texture before then.
  vec2 texel = nuv * vec2(textureSize(uNear, 0));
  vec2 tdx = dFdx(texel);
  vec2 tdy = dFdy(texel);
  float lod = 0.5 * log2(max(max(dot(tdx, tdx), dot(tdy, tdy)), 1e-8));
  float resolved = 1.0 - smoothstep(${(NEAR_MEAN_LOD - 1.5).toFixed(1)}, ${NEAR_MEAN_LOD.toFixed(1)}, lod);
  vec2 edge = min(nuv, 1.0 - nuv);
  // Fades in over the outer 10% of the block, so its edge is not a line.
  nearW = uNearOn * smoothstep(0.0, 0.1, min(edge.x, edge.y)) * hi.a * resolved;
  if (nearW > 0.0) {
    // Premultiplied: the grey is r / a, over imaged pixels only.
    float detail = hi.r / max(hi.a, 1e-5) - mean.r / max(mean.a, 1e-5);
    vec3 srgb = sRGBTransferOETF(vec4(diffuseColor.rgb, 1.0)).rgb;
    float lum = dot(srgb, vec3(0.3, 0.59, 0.11)) + detail;
    vec3 sharp = sRGBTransferEOTF(vec4(withLum(srgb, clamp(lum, 0.0, 1.0)), 1.0)).rgb;
    diffuseColor.rgb = mix(diffuseColor.rgb, sharp, nearW);
  }
}
`

const FRAGMENT_DETAIL = `
{
  float dist = length(vViewPosition);
  // Offset by the patch's place in the drop point's frame, so the pattern
  // carries on across a patch rebuild instead of shifting under the walker.
  vec2 p = vGroundPos.xz + uOrigin;
  // Tile sizes in metres, none a multiple of another. Each scale's pair of
  // copies is picked by the next coarser scale's broad channel, and the
  // coarsest by a 9 km lookup, so no scale repeats within a patch.
  float broad = texture2D(uDetail, p / 9000.0 + vec2(0.23, 0.61)).a;
  vec4 far = untiled(p / 1700.0 + vec2(0.91, 0.47), broad);
  vec4 mid = untiled(p / 190.0 + vec2(0.37, 0.83), far.a);
  vec4 near = untiled(p / 23.0 + vec2(0.57, 0.29), mid.a);
  vec4 fine = untiled(p / 2.9 + vec2(0.13, 0.71), near.a);

  float closeF = 1.0 - smoothstep(15.0, 90.0, dist);
  float nearF = 1.0 - smoothstep(120.0, 900.0, dist);
  float midF = 1.0 - smoothstep(1500.0, 9000.0, dist);

  float lum = 1.0;
  lum *= mix(1.0, 0.72 + 0.56 * fine.r, closeF);
  // Painted specks stay faint: the 3D pebbles (Rocks) carry that detail.
  lum *= mix(1.0, 1.0 - 0.18 * fine.b * near.r, closeF);
  // Metre scales: left off where the near-field image shows the real ones;
  // both average about 1, so the block's edge keeps the ground's brightness.
  lum *= mix(1.0, 0.8 + 0.4 * near.r, nearF * (1.0 - nearW));
  lum *= mix(1.0, 1.0 - 0.12 * near.b, nearF * 0.6 * (1.0 - nearW));
  lum *= mix(1.0, 0.82 + 0.36 * mid.g, midF);
  lum *= 0.86 + 0.28 * far.a;

  // Dust (lighter, warmer) where the ground is flat and the broad noise is high;
  // dark sand elsewhere; rock-darkened slopes.
  float slope = 1.0 - clamp(vGroundNormal.y, 0.0, 1.0);
  float dust = smoothstep(0.35, 0.75, mid.a) * (1.0 - smoothstep(0.04, 0.25, slope));
  vec3 tint = mix(vec3(0.84, 0.8, 0.8), vec3(1.1, 1.0, 0.9), dust);
  tint *= mix(1.0, 0.78, smoothstep(0.12, 0.5, slope));

  diffuseColor.rgb *= lum * tint;
}
`

/**
 * The material's `onBeforeCompile`. Make it once per detail texture and
 * pass the same function every render, so the program is compiled once.
 * `origin` is the current patch centre in the drop point's metres (x east,
 * y the shader's z, south); the caller mutates it when the patch changes,
 * and `near` likewise (useNearField).
 */
export function groundShader(detail: Texture, origin: Vector2, near: NearUniforms) {
  return (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uDetail = { value: detail }
    shader.uniforms.uOrigin = { value: origin }
    Object.assign(shader.uniforms, near)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace('#include <bumpmap_pars_fragment>', FADED_BUMP_CHUNK)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAGMENT_NEAR}\n${FRAGMENT_DETAIL}`)
  }
}
