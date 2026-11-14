/**
 * The line added after a lit material's map is sampled: the texel's
 * luminance, weighted as the canvas `saturation` blend weighs it on the
 * sRGB values (0.3, 0.59, 0.11), so a greyscale tile matches the grey base
 * the shell draws on a canvas. The map arrives linear in the
 * shader, so it is taken to sRGB (approximately, gamma 2.2) and back.
 */
export const GREYSCALE_LINE =
  'diffuseColor.rgb = vec3( pow( dot( pow( diffuseColor.rgb, vec3( 1.0 / 2.2 ) ), vec3( 0.3, 0.59, 0.11 ) ), 2.2 ) );'

const MAP_FRAGMENT = '#include <map_fragment>'

/**
 * `onBeforeCompile` for a lit material whose map should show greyscale.
 * One function for every such material, so three.js compiles one
 * program for them (its cache key is this function's source).
 */
export function greyscaleMap(shader: { fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader.replace(MAP_FRAGMENT, `${MAP_FRAGMENT}\n${GREYSCALE_LINE}`)
}
