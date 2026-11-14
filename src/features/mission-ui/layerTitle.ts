/**
 * Labels read "Satellite (Viking colour mosaic)": the word before the
 * bracket is the title under a layer tile, the whole label stays the
 * button's accessible name.
 */
export function shortTitle(label: string): string {
  const cut = label.indexOf(' (')
  return cut === -1 ? label : label.slice(0, cut)
}
