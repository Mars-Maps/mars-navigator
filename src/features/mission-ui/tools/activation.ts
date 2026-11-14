/**
 * The active-tool rule: at most one tool is active. Pressing the
 * active tool's button releases it; pressing another replaces it.
 */
export function nextActiveTool(current: string | null, pressed: string): string | null {
  return current === pressed ? null : pressed
}

/**
 * Ids that appear more than once, in first-seen order. The store holds a
 * bare id, so a duplicate would make two buttons light up for one state.
 */
export function duplicateToolIds(tools: readonly { id: string }[]): string[] {
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const { id } of tools) {
    if (seen.has(id) && !duplicates.includes(id)) duplicates.push(id)
    seen.add(id)
  }
  return duplicates
}
