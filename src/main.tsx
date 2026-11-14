import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'
import { ErrorBoundary, RootFailure } from './app/ErrorBoundary.tsx'

// The globe and the surface view are separate chunks. A tab opened
// before a deploy asks for chunk names that no longer exist; with no error
// boundary the app would go blank, so reload for the new page instead. At
// most once a minute, so a chunk that is really missing cannot loop.
const RELOAD_KEY = 'chunk-reload-at'
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // Storage blocked: reloading without the guard could loop, so do not.
    return
  }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The last line: App's own boundaries keep a failed part to its slot. */}
    <ErrorBoundary fallback={() => <RootFailure />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
