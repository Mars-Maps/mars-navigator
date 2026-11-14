/**
 * What Escape does when pressed inside the search bar. A running
 * pick on the globe is the newest thing Escape can end, so it is cancelled
 * first and the bar stays as it is; otherwise an open bar closes. null
 * leaves the press to the shared Escape rule.
 */
export function searchBarEscape(picking: boolean, expanded: boolean): 'cancel-pick' | 'close' | null {
  if (picking) return 'cancel-pick'
  return expanded ? 'close' : null
}
