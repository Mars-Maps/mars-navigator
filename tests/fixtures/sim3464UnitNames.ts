/**
 * The unit names and symbols of the USGS SIM 3464 feature service, Geologic
 * Units layer (layer 8), as the service spells them: every distinct
 * (name, symbol) pair with its polygon count, read on 2026-11-01 with
 * `returnGeometry=false`. OFFICIAL text copied verbatim, typo included:
 * the crater rim unit is spelled two ways on the service. Re-read it, do
 * not retype it, when the service changes.
 *
 * https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer/8
 */
export const SIM_3464_UNIT_NAMES_READ = '2026-11-01'

export const SIM_3464_UNIT_NAMES: readonly { name: string; symbol: string; polygons: number }[] = [
  { name: 'Crater ejecta unit', symbol: 'ce', polygons: 16 },
  { name: 'Crater interior unit', symbol: 'ci', polygons: 9 },
  { name: 'Crater riim unit', symbol: 'cr', polygons: 1 },
  { name: 'Crater rim unit', symbol: 'cr', polygons: 64 },
  { name: 'Eolian bedform unit', symbol: 'Aeb', polygons: 476 },
  { name: 'Jezero fan 1 unit', symbol: 'NHjf1', polygons: 9 },
  { name: 'Jezero fan 2 unit', symbol: 'NHjf2', polygons: 15 },
  { name: 'Jezero floor unit', symbol: 'Njf', polygons: 13 },
  { name: 'Lower etched unit', symbol: 'Nle', polygons: 20 },
  { name: 'Nili Planum 1 unit', symbol: 'Nnp1', polygons: 157 },
  { name: 'Nili Planum 2 unit', symbol: 'Nnp2', polygons: 127 },
  { name: 'Nili Planum fan unit', symbol: 'Hnpf', polygons: 8 },
  { name: 'Rugged bright unit', symbol: 'Nrb', polygons: 69 },
  { name: 'Smooth unit, undivided', symbol: 'su', polygons: 53 },
  { name: 'Upper etched unit', symbol: 'Nue', polygons: 271 },
]
