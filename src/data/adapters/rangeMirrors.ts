/**
 * The same S3 bucket on several addresses: range reads of
 * a DEM spread over them, so the browser's six connections per host become
 * six per address. A patch's 201 row reads take about 34 round trips one
 * host at a time and about 8 spread over five addresses by the hash below
 * (counted, not timed: 30 reads in flight, six per host). An earlier replay,
 * which took the addresses in turn, measured 7.7–8.5 s down to 1.9–2.3 s;
 * this code has not been timed in a browser.
 *
 * These are not copies: each address is an endpoint form of the one bucket
 * USGS publishes (asc-pds-services, us-west-2), so every one serves the same
 * object. That is the guarantee; nothing at run time checks it, since S3
 * exposes neither the ETag nor Content-Range to scripts (no
 * Access-Control-Expose-Headers). Checked by hand 26 Oct and 13 Nov:
 * a range read on each address answered 206 with
 * `Access-Control-Allow-Origin: *` and, per file, one ETag and one size on
 * all five, for all four DEMs the app reads (the 200 m blend:
 * "94ec792407f5a3da2f8b87aba42613eb-1358", 11,384,463,908 bytes).
 *
 * The path-style and the two older address forms are legacy; they answer for
 * this bucket today. A read that fails on one of them is read once more
 * from the named address (`readFromMirror`), so the app is never worse off
 * than with the one address. If an address stops answering, drop it here.
 */

/** The address the DEM sources name (`demSources.ts`). */
export const ASC_PDS_S3 = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/'

/** Every address of that bucket, the named one first. Each ends with a slash, before the object's key. */
export const ASC_PDS_S3_ADDRESSES: readonly string[] = [
  ASC_PDS_S3,
  'https://asc-pds-services.s3.dualstack.us-west-2.amazonaws.com/',
  'https://s3.us-west-2.amazonaws.com/asc-pds-services/',
  'https://asc-pds-services.s3-us-west-2.amazonaws.com/',
  'https://asc-pds-services.s3.amazonaws.com/',
]

/** Connections a browser opens to one host over HTTP/1.1, which is all S3 offers. */
export const PER_HOST_CONNECTIONS = 6

/** The addresses `url` can be read from: every address of the bucket for a file in it, else `url` alone. */
export function mirrorsOf(url: string): readonly string[] {
  if (!url.startsWith(ASC_PDS_S3)) return [url]
  const key = url.slice(ASC_PDS_S3.length)
  return ASC_PDS_S3_ADDRESSES.map((base) => base + key)
}

/**
 * The address a range starting at byte `start` of `url` is read from.
 * Fixed per range, not taken in turn, so a reread of the same range hits
 * the same URL and the browser's cache answers it. Spread by a
 * multiplicative hash of the range's 2 KB block, since a DEM's row reads
 * sit a fixed stride apart.
 */
export function mirrorFor(url: string, start: number): string {
  const all = mirrorsOf(url)
  if (all.length === 1) return all[0]
  const block = Math.floor(start / 2048)
  // Knuth's multiplicative hash, on the low 32 bits of the block number.
  const hash = Math.imul(block >>> 0, 2654435761) >>> 0
  return all[hash % all.length]
}

/**
 * Reads the range starting at `start` of `url` from its address with
 * `read`; if that address is not the named one and the read fails (the
 * request rejects, or `read` throws on an answer that is not the range),
 * reads it once more from `url` itself. An aborted read is not retried, and
 * a failure on the named address is the caller's to report: there is nowhere
 * else to ask.
 */
export async function readFromMirror<T>(
  url: string,
  start: number,
  signal: AbortSignal,
  read: (address: string) => Promise<T>,
): Promise<T> {
  const address = mirrorFor(url, start)
  if (address === url) return read(url)
  try {
    return await read(address)
  } catch (e) {
    if (signal.aborted) throw e
    return read(url)
  }
}
