'use client'

import { useId } from 'react'
export function VisitSectionJump({ scopeId, sections }: { scopeId: string; sections: readonly { key: string; label: string }[] }) {
  const id = useId()
  return <div className="flex flex-wrap items-center gap-2 text-sm">
    <label htmlFor={id}>Jump to section</label>
    <select id={id} defaultValue="" className="min-w-0 max-w-full rounded-md border bg-background p-2" onChange={event => {
      const section = document.getElementById(`${scopeId}-${event.target.value}`)
      if (!section || section.closest('[hidden]')) return
      section.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
      section.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true })
      event.target.value = ''
    }}>
      <option value="" disabled>Select a section</option>
      {sections.map(section => <option key={section.key} value={section.key}>{section.label}</option>)}
    </select>
  </div>
}
