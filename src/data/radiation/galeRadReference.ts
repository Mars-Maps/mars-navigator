import { GALE_RAD_ELEVATION_KM, official, type RadiationReference } from '../../domain'

/**
 * The one surface radiation measurement on Mars:
 * Curiosity's Radiation Assessment Detector at Gale crater over its first
 * ~300 sols. Shown as a cited reference; never scaled to Jezero or to any
 * other point (Perseverance carries no dosimeter, and no scaling by
 * elevation is published).
 *
 * OFFICIAL: every number is copied from the accepted manuscript, checked on
 * 2026-10-28. The press release rounds the dose equivalent to 0.67; the
 * paper says 0.64, and the paper is what is cited.
 */

export const HASSLER_2014_DOI = 'https://doi.org/10.1126/science.1244797'

/** The accepted manuscript, open access, the copy the values were checked against. */
export const HASSLER_2014_MANUSCRIPT_URL =
  'https://authors.library.caltech.edu/records/kdt88-3aw98/files/RAD_Surface_Results_paper_SCIENCE_12nov13_FINAL.pdf'

export const HASSLER_2014_CITATION = `Hassler, D.M., et al., 2014, Mars' surface radiation environment measured with the Mars Science Laboratory's Curiosity rover: Science, v. 343, 1244797, ${HASSLER_2014_DOI} (accepted manuscript ${HASSLER_2014_MANUSCRIPT_URL}; values checked 2026-10-28)`

const cite = (quote: string) => `${HASSLER_2014_CITATION} — "${quote}"`

export const GALE_RAD_REFERENCE: RadiationReference = {
  site: 'Gale crater',
  instrument: 'Curiosity RAD',
  // The domain's figure (the shielding rule's reference), so there is one copy.
  elevationKm: GALE_RAD_ELEVATION_KM,
  period: '7 Aug 2012 – 1 Jun 2013, about 300 sols',
  conditions: 'near the maximum of solar cycle 24',
  doseEquivalent: official(
    { value: 0.64, uncertainty: 0.12, unit: 'mSv/day' },
    cite('an average GCR dose equivalent rate on the Mars surface of 0.64 ± 0.12 mSv/day'),
  ),
  absorbedDose: official(
    { value: 0.21, uncertainty: 0.04, unit: 'mGy/day' },
    cite('an average total GCR dose rate at Gale Crater (-4.4 km MOLA) of 0.210 +/- 0.040 mGy/day'),
  ),
  qualityFactor: official(
    { value: 3.05, uncertainty: 0.3, unit: '' },
    cite('the average Quality Factor <Q> on the Martian surface to be 3.05 +/- 0.3'),
  ),
}
