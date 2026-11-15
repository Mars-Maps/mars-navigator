/** The warning triangle: beside a warning's words, so colour is never the only signal. */
export function WarningGlyph({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 3 2 21h20L12 3zm-1 6h2v6h-2V9zm0 8h2v2h-2v-2z" />
    </svg>
  )
}
