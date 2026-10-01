// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VisitDraftActionBar } from '../visit-draft-action-bar'
let barHeight = 200
let scrollHeight = 600
let resize: () => void
const disconnect = vi.fn()
beforeEach(() => {
  barHeight = 200; scrollHeight = 600
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect = disconnect })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) { return { height: this.hasAttribute('data-visit-action-bar') ? barHeight : scrollHeight } as DOMRect })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => scrollHeight)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })
function fixture(readOnly = false) {
  return <main style={{ overflowY: 'auto' }}><div data-testid="scope"><VisitDraftActionBar dirty={false} busy={false} readOnly={readOnly}><button>Save Draft</button></VisitDraftActionBar><textarea aria-label="Note" /></div></main>
}
const bar = () => screen.getByRole('button', { name: 'Save Draft' }).parentElement!
it('keeps controls sticky while leaving at least half the scroll area for the note', () => {
  render(fixture())
  expect(bar().classList.contains('sticky')).toBe(true)
  expect(screen.getByTestId('scope').style.getPropertyValue('--visit-action-height')).toBe('216px')
  barHeight = 400; act(() => resize())
  expect(bar().classList.contains('sticky')).toBe(false)
  expect(screen.getByTestId('scope').style.getPropertyValue('--visit-action-height')).toBe('16px')
  expect(screen.getByRole('textbox', { name: 'Note' })).toBeTruthy()
  barHeight = 180; act(() => resize())
  expect(bar().classList.contains('sticky')).toBe(true)
})
it('responds to a shrinking scroll container and window resize', () => {
  render(fixture())
  scrollHeight = 350; fireEvent(window, new Event('resize'))
  expect(bar().classList.contains('sticky')).toBe(false)
})
it('never pins read-only controls and disconnects observers when removed', () => {
  const view = render(fixture(true))
  expect(bar().classList.contains('sticky')).toBe(false)
  expect(screen.queryByRole('status')).toBeNull()
  view.unmount(); expect(disconnect).toHaveBeenCalledOnce()
})
