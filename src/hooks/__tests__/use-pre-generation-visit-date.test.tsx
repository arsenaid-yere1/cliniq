// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VisitTestProvider } from '@/test-utils/visit-render'
import { usePreGenerationVisitDate } from '../use-pre-generation-visit-date'
import type { VisitDateSaveResult } from '@/lib/validations/visit-date'
const save = vi.hoisted(() => vi.fn())
vi.mock('@/actions/visit-date', () => ({ savePreGenerationVisitDate: save }))
const base = { caseId: 'case', episodeId: 'episode', kind: 'initial_visit' as const, enabled: true,
  noteId: 'note', visitDate: '2026-09-01', updatedAt: '2026-09-01T00:00:00Z' }
const response = (visitDate: string): VisitDateSaveResult => ({ data: { noteId: 'note', visitDate, updatedAt: '2026-09-30T00:00:00Z' } })
const deferred = () => { let resolve!: (r: VisitDateSaveResult) => void; return { promise: new Promise<VisitDateSaveResult>(r => { resolve = r }), resolve } }
beforeEach(() => { save.mockReset(); save.mockImplementation(async input => response(input.visitDate)) })
afterEach(cleanup)
describe('pre-generation date queue', () => {
  it('saves on request and preserves an acknowledged date against stale props', async () => {
    const { result, rerender } = renderHook(props => usePreGenerationVisitDate(props), { wrapper: VisitTestProvider, initialProps: base })
    act(() => result.current.change('2026-09-03'))
    await act(async () => { await result.current.save() })
    expect(result.current.status).toBe('Date saved')
    rerender({ ...base, updatedAt: '2026-09-02T00:00:00Z' })
    expect(result.current.value).toBe('2026-09-03')
  })
  it('does not send unchanged blur requests', async () => {
    const { result } = renderHook(() => usePreGenerationVisitDate(base), { wrapper: VisitTestProvider })
    await act(async () => { await result.current.save() })
    expect(save).not.toHaveBeenCalled()
  })
  it('materializes an untouched default only when explicitly flushed', async () => {
    const { result } = renderHook(() => usePreGenerationVisitDate({ ...base, noteId: undefined, visitDate: null }), { wrapper: VisitTestProvider })
    expect(result.current.status).toBe('Not saved yet')
    await act(async () => { await result.current.blur() })
    expect(save).not.toHaveBeenCalled()
    await act(async () => { await result.current.flush() })
    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('Date saved')
  })
  it('reuses pending blur and flushes a newer revision before generating', async () => {
    const first = deferred(); save.mockReturnValueOnce(first.promise)
    const { result } = renderHook(() => usePreGenerationVisitDate(base), { wrapper: VisitTestProvider })
    act(() => result.current.change('2026-09-02'))
    let pending!: Promise<VisitDateSaveResult>
    act(() => { void result.current.save(); pending = result.current.flush() })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(result.current.status).toBe('Saving date…')
    act(() => result.current.change('2026-09-03'))
    await act(async () => { first.resolve(response('2026-09-02')); await pending })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0]).toMatchObject({ visitDate: '2026-09-03', expectedDate: '2026-09-02' })
    expect(result.current.value).toBe('2026-09-03')
    expect(result.current.status).toBe('Date saved')
  })
  it('a failed blur blocks Generate without an automatic second request', async () => {
    const first = deferred(); save.mockReturnValueOnce(first.promise)
    const { result } = renderHook(() => usePreGenerationVisitDate(base), { wrapper: VisitTestProvider })
    act(() => { result.current.change('2026-09-02'); void result.current.save() })
    await act(async () => { first.resolve({ error: 'Offline', code: 'save_failed' }); await first.promise })
    await act(async () => { expect(await result.current.flush()).toMatchObject({ error: 'Offline' }) })
    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current.value).toBe('2026-09-02')
    await act(async () => { await result.current.save() })
    expect(save).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('Date saved')
  })
  it('requires an explicit conflict choice before adopting a newer expected date', async () => {
    save.mockResolvedValueOnce({ error: 'Conflict', code: 'conflict', conflict: { noteId: 'note', visitDate: '2026-09-04', updatedAt: 'v2' } })
    const { result } = renderHook(() => usePreGenerationVisitDate(base), { wrapper: VisitTestProvider })
    act(() => result.current.change('2026-09-03'))
    await act(async () => { await result.current.save(); await result.current.flush() })
    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current.value).toBe('2026-09-03')
    await act(async () => { await result.current.keepMine() })
    expect(save.mock.calls[1][0]).toMatchObject({ expectedDate: '2026-09-04', visitDate: '2026-09-03' })
  })
  it('Use saved date adopts the canonical date without another write', async () => {
    save.mockResolvedValueOnce({ error: 'Conflict', code: 'conflict', conflict: { noteId: 'note', visitDate: '2026-09-04', updatedAt: 'v2' } })
    const { result } = renderHook(() => usePreGenerationVisitDate(base), { wrapper: VisitTestProvider })
    act(() => result.current.change('2026-09-03'))
    await act(async () => { await result.current.save() })
    act(() => result.current.useSaved())
    expect(result.current.value).toBe('2026-09-04')
    expect(result.current.dirty).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
  })
  it('ignores an old episode completion', async () => {
    const first = deferred(); save.mockReturnValueOnce(first.promise)
    const { result, rerender } = renderHook(props => usePreGenerationVisitDate(props), { wrapper: VisitTestProvider, initialProps: base })
    act(() => { result.current.change('2026-09-02'); void result.current.save() })
    rerender({ ...base, episodeId: 'new-episode', visitDate: '2026-09-10' })
    await act(async () => { first.resolve(response('2026-09-02')); await first.promise })
    expect(result.current.value).toBe('2026-09-10')
  })
  it('retains invalid input and refuses locked saves', async () => {
    const { result, rerender } = renderHook(props => usePreGenerationVisitDate(props), { wrapper: VisitTestProvider, initialProps: base })
    act(() => result.current.change('2026-02-30'))
    await act(async () => { await result.current.save() })
    expect(result.current.error).toBeTruthy()
    expect(result.current.value).toBe('2026-02-30')
    rerender({ ...base, enabled: false })
    await act(async () => { expect(await result.current.save()).toMatchObject({ code: 'locked' }) })
    expect(save).not.toHaveBeenCalled()
  })
})
