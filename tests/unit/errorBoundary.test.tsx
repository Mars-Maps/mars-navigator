import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ErrorBoundary, FailedPart, LoadingPart, RootFailure } from '../../src/app/ErrorBoundary'

// The server renderer never calls getDerivedStateFromError, so the catch
// itself is checked in the browser; here, the state change and what
// each state renders.

const fallback = () => <FailedPart what="The 3D view" />

function boundaryIn(error: unknown) {
  const b = new ErrorBoundary({ children: <p>scene</p>, fallback })
  b.state = { error }
  return renderToStaticMarkup(<>{b.render()}</>)
}

describe('ErrorBoundary', () => {
  it('renders its children while nothing has failed', () => {
    expect(renderToStaticMarkup(<ErrorBoundary fallback={fallback}><p>scene</p></ErrorBoundary>)).toBe('<p>scene</p>')
  })

  it('holds the error a child threw', () => {
    const error = new Error('chunk failed')
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error })
  })

  it('holds something even when a child throws null or undefined', () => {
    expect(ErrorBoundary.getDerivedStateFromError(null).error).toBeInstanceOf(Error)
    expect(ErrorBoundary.getDerivedStateFromError(undefined).error).toBeInstanceOf(Error)
  })

  it('renders the fallback, not the children, once it holds an error', () => {
    const html = boundaryIn(new Error('chunk failed'))
    expect(html).not.toContain('scene</p>')
    expect(html).toContain('The 3D view failed to load.')
  })
})

describe('FailedPart', () => {
  it('is an alert naming what failed, with a Reload button', () => {
    const html = renderToStaticMarkup(<FailedPart what="The stop card" panel />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('The stop card failed to load.')
    expect(html).toMatch(/<button type="button"[^>]*>Reload<\/button>/)
  })

  it('names the app at the root', () => {
    expect(renderToStaticMarkup(<RootFailure />)).toContain('Mars Navigator failed to load.')
  })
})

// A lazy panel's stand-in sits in the same frame a failed panel does, never as a bare line over the map.
describe('LoadingPart', () => {
  it('is a status line naming what loads, in the panel frame FailedPart uses', () => {
    const loading = renderToStaticMarkup(<LoadingPart what="the rover photos" />)
    expect(loading).toContain('role="status"')
    expect(loading).toContain('Loading the rover photos…')
    const frame = (html: string) => ['rounded-panel', 'bg-surface/70', 'shadow-panel', 'backdrop-blur-glass'].filter((c) => html.includes(c))
    expect(frame(loading)).toEqual(frame(renderToStaticMarkup(<FailedPart what="x" panel />)))
    expect(frame(loading)).toHaveLength(4)
  })
})
