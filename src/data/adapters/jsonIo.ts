/**
 * The one way the adapters fetch a JSON document: a non-OK status
 * throws `HTTP <status>`, the signal aborts the request, and the body is
 * parsed as JSON. Each adapter validates the shape itself. Tests inject a
 * fixture io in its place.
 */
export interface JsonIo {
  fetchJson(url: string, signal: AbortSignal): Promise<unknown>
}

export const defaultJsonIo: JsonIo = {
  async fetchJson(url, signal) {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  },
}
