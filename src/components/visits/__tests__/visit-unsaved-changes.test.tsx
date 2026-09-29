// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { VisitUnsavedChangesProvider, useVisitDraftBaseline, useVisitExitGuard, useVisitUnsavedChanges } from '../visit-unsaved-changes-context'
function Draft({ name }: { name: string }) {
  const [text, setText] = useState('saved')
  const [version, setVersion] = useState('v1')
  const acknowledge = useVisitDraftBaseline({ text, expected_updated_at: version })
  return <div><input aria-label={name} value={text} onChange={e => setText(e.target.value)} /><button onClick={() => acknowledge({ text, expected_updated_at: version })}>Save {name}</button><button onClick={() => setVersion('v2')}>Version {name}</button></div>
}
function Busy() { useVisitUnsavedChanges(false, true); return null }
function ProgrammaticExit() { const guard = useVisitExitGuard(); return <button onClick={() => guard.confirmExit()}>Programmatic exit</button> }
const confirm = vi.spyOn(window, 'confirm')
afterEach(() => { cleanup(); confirm.mockReset() })
function setup() {
  render(<VisitUnsavedChangesProvider><Draft name="initial" /><Draft name="pain" /><a href="/all-visits" onClick={e => e.preventDefault()}>All visits</a><a href="#section">Section</a><a href="/pdf" download>Download</a><a href="/new" target="_blank">New tab</a><ProgrammaticExit /></VisitUnsavedChangesProvider>)
}
it('aggregates hidden/multiple drafts and cancelling preserves both values with one prompt', () => {
  setup(); confirm.mockReturnValue(false)
  fireEvent.change(screen.getByLabelText('initial'), { target: { value: 'first draft' } })
  fireEvent.change(screen.getByLabelText('pain'), { target: { value: 'second draft' } })
  expect(fireEvent.click(screen.getByText('All visits'))).toBe(false)
  expect(confirm).toHaveBeenCalledTimes(1)
  expect((screen.getByLabelText('initial') as HTMLInputElement).value).toBe('first draft')
  expect((screen.getByLabelText('pain') as HTMLInputElement).value).toBe('second draft')
})
it('only clears the acknowledged draft and ignores metadata version changes', () => {
  setup(); confirm.mockReturnValue(false)
  fireEvent.click(screen.getByText('Version initial'))
  fireEvent.click(screen.getByText('Programmatic exit'))
  expect(confirm).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('initial'), { target: { value: 'edited' } })
  fireEvent.change(screen.getByLabelText('pain'), { target: { value: 'other edit' } })
  fireEvent.click(screen.getByText('Save initial'))
  fireEvent.click(screen.getByText('Programmatic exit'))
  expect(confirm).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByText('Save pain'))
  fireEvent.click(screen.getByText('Programmatic exit'))
  expect(confirm).toHaveBeenCalledTimes(1)
})
it('ignores download, hash and modified/new-tab clicks', () => {
  setup(); confirm.mockReturnValue(false)
  fireEvent.change(screen.getByLabelText('initial'), { target: { value: 'edited' } })
  for (const name of ['Section', 'Download', 'New tab']) fireEvent.click(screen.getByText(name))
  fireEvent.click(screen.getByText('All visits'), { ctrlKey: true })
  fireEvent.click(screen.getByText('All visits'), { metaKey: true })
  expect(confirm).not.toHaveBeenCalled()
})
it('protects unload during work and removes registrations on unmount', () => {
  const view = render(<VisitUnsavedChangesProvider><Busy /></VisitUnsavedChangesProvider>)
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  view.unmount()
  const next = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(next)
  expect(next.defaultPrevented).toBe(false)
})
it('allows confirmed controlled exits', () => {
  setup(); confirm.mockReturnValue(true)
  fireEvent.change(screen.getByLabelText('initial'), { target: { value: 'edited' } })
  fireEvent.click(screen.getByText('Programmatic exit'))
  expect(confirm).toHaveBeenCalledOnce()
})
