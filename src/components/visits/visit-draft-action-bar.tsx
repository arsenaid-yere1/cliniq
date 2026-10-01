'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
export interface VisitSaveState { dirty: boolean; busy: boolean; error?: string | null; hasSaved?: boolean; finalizationError?: boolean }

export function VisitSaveStatus({ dirty, busy, error, hasSaved, finalizationError }: VisitSaveState) {
  const label = busy ? 'Saving…' : error ? (finalizationError ? 'Saved; finalization failed' : 'Save failed') : dirty ? 'Unsaved changes' : hasSaved ? 'Saved' : 'No unsaved changes'
  return <div className="space-y-1 text-sm">
    <p role="status" aria-live="polite" aria-atomic="true" className={error ? 'font-medium text-destructive' : 'text-muted-foreground'}>{label}{error && dirty ? ' · Unsaved changes' : ''}</p>
    {error && <p className="text-destructive break-words">{error}</p>}
    {dirty && <p className="text-muted-foreground">Save changes before leaving this visit.</p>}
  </div>
}

export function VisitDraftActionBar({ children, readOnly = false, ...state }: VisitSaveState & { children: ReactNode; readOnly?: boolean }) {
  const bar = useRef<HTMLDivElement>(null)
  const [sticky, setSticky] = useState(false)
  useLayoutEffect(() => {
    const element = bar.current
    const parent = element?.parentElement
    if (!element || !parent) return
    // The dashboard scrolls inside main. Use that available height, including
    // when browser zoom or the on-screen keyboard reduces the editing area.
    let scroller: HTMLElement | null = parent
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement
    }
    const measure = () => {
      const height = element.getBoundingClientRect().height
      const available = Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight, scroller?.clientHeight || window.innerHeight)
      const canStick = !readOnly && height > 0 && height <= available / 2
      setSticky(canStick)
      parent.style.setProperty('--visit-action-height', `${canStick ? height + 16 : 16}px`)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    if (scroller) observer?.observe(scroller)
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      parent.style.removeProperty('--visit-action-height')
    }
  }, [readOnly])
  return <div ref={bar} data-visit-action-bar className={readOnly ? 'space-y-3' : `${sticky ? 'sticky top-0 z-20 ' : ''}space-y-3 rounded-lg border bg-background p-3 shadow-sm`}>
    {children}
    {!readOnly && <VisitSaveStatus {...state} />}
  </div>
}
