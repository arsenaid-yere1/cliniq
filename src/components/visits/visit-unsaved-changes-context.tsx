'use client'

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

type DraftState = { dirty: boolean; busy: boolean }
type Guard = { register: (id: string, state: DraftState) => () => void; confirmExit: () => boolean }
const Context = createContext<Guard | null>(null)

export function VisitUnsavedChangesProvider({ children }: { children: ReactNode }) {
  const drafts = useRef(new Map<string, DraftState>())
  const register = useCallback((id: string, state: DraftState) => {
    drafts.current.set(id, state)
    return () => { drafts.current.delete(id) }
  }, [])
  const hasChanges = useCallback(() => [...drafts.current.values()].some(d => d.dirty || d.busy), [])
  const confirmExit = useCallback(() => !hasChanges() || window.confirm('Unsaved visit changes or work in progress may be lost. Leave this page?'), [hasChanges])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasChanges()) return
      event.preventDefault(); event.returnValue = ''
    }
    const beforeNavigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return
      const url = new URL(anchor.href, window.location.href)
      if (!['http:', 'https:'].includes(url.protocol)) return
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return
      if (!confirmExit()) { event.preventDefault(); event.stopPropagation() }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', beforeNavigate, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', beforeNavigate, true)
    }
  }, [confirmExit, hasChanges])
  return <Context.Provider value={{ register, confirmExit }}>{children}</Context.Provider>
}

export function useVisitExitGuard() {
  const context = useContext(Context)
  if (!context) throw new Error('VisitUnsavedChangesProvider is required')
  return context
}
export function useVisitUnsavedChanges(dirty: boolean, busy = false) {
  const { register } = useVisitExitGuard()
  const id = useId()
  useLayoutEffect(() => register(id, { dirty, busy }), [register, id, dirty, busy])
}
function fingerprint(value: unknown): string {
  return JSON.stringify(value, (key, item) => key === 'expected_updated_at' ? undefined : item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
}
/** Save acknowledgements change only the baseline, never the clinician's current values. */
export function useVisitDraftState<T>(current: T, busy = false, enabled = true, initiallyDirty = false) {
  const [baseline, setBaseline] = useState(() => fingerprint(current))
  const [acknowledged, setAcknowledged] = useState(false)
  const dirty = enabled && (fingerprint(current) !== baseline || (initiallyDirty && !acknowledged))
  useVisitUnsavedChanges(dirty, enabled && busy)
  const acknowledge = useCallback((saved: T) => { setBaseline(fingerprint(saved)); setAcknowledged(true) }, [])
  return { acknowledge, dirty, busy: enabled && busy, hasSaved: acknowledged }
}

export function useVisitDraftBaseline<T>(current: T, busy = false, enabled = true, initiallyDirty = false) {
  return useVisitDraftState(current, busy, enabled, initiallyDirty).acknowledge
}
