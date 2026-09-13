// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDraftNoteMutations, useNoteMutationQueue } from '../use-note-mutation-queue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

it('serializes tasks and recovers after a rejected task', async () => {
  const first = deferred<void>()
  const order: string[] = []
  const { result } = renderHook(() => useNoteMutationQueue('note', true))
  const a = result.current.enqueue(async () => { order.push('first'); await first.promise })
  const rejection = expect(a).rejects.toThrow('failed')
  const b = result.current.enqueue(async () => { order.push('second') })
  await waitFor(() => expect(order).toEqual(['first']))
  first.reject(new Error('failed'))
  await rejection
  await b
  expect(order).toEqual(['first', 'second'])
})

it.each(['unmount', 'identity', 'locked', 'finalized'])('skips unstarted work after %s', async (reason) => {
  const first = deferred<void>()
  const next = vi.fn()
  const { result, rerender, unmount } = renderHook(({ id, writable }) => useNoteMutationQueue(id, writable), { initialProps: { id: 'note', writable: true } })
  const a = result.current.enqueue(async ({ finish }) => { await first.promise; if (reason === 'finalized') finish() })
  const b = result.current.enqueue(next)
  await Promise.resolve()
  if (reason === 'unmount') unmount()
  if (reason === 'identity') rerender({ id: 'other', writable: true })
  if (reason === 'locked') rerender({ id: 'note', writable: false })
  first.resolve()
  await a; await b
  expect(next).not.toHaveBeenCalled()
})

function setup() {
  let version = 'v1'
  const saveTone = vi.fn(async (tone: string | null, expected: string) => ({ data: { updated_at: expected === 'v1' ? 'v2' : 'v3', tone_hint: tone } }))
  const error = vi.fn()
  const hook = renderHook(({ toneHint }) => useDraftNoteMutations({
    identity: 'note', writable: true, initialTone: null, toneHint,
    getVersion: () => version,
    acknowledgeVersion: (_expected, saved) => { version = saved },
    saveTone, onError: error,
  }), { initialProps: { toneHint: 'Concise' } })
  return { ...hook, saveTone, error, version: () => version, setVersion: (next: string) => { version = next } }
}

describe('tone dependencies', () => {
  it('waits for blur and uses its version without saving unchanged tone again', async () => {
    const tone = deferred<{ data: { updated_at: string; tone_hint: string | null } }>()
    const h = setup()
    h.saveTone.mockReturnValueOnce(tone.promise)
    const versions: string[] = []
    act(() => h.result.current.saveTone())
    const action = h.result.current.run(async () => { versions.push(h.version()) })
    await waitFor(() => expect(h.saveTone).toHaveBeenCalledTimes(1))
    expect(versions).toEqual([])
    tone.resolve({ data: { updated_at: 'v2', tone_hint: 'Concise' } })
    await action
    expect(versions).toEqual(['v2'])
    expect(h.saveTone).toHaveBeenCalledTimes(1)
  })

  it('aborts an already-waiting action after a failed blur; later user retry succeeds', async () => {
    const tone = deferred<{ data: { updated_at: string; tone_hint: string | null } }>()
    const h = setup()
    h.saveTone.mockReturnValueOnce(tone.promise)
    const next = vi.fn(async () => {})
    act(() => h.result.current.saveTone())
    const action = h.result.current.run(next)
    tone.reject(new Error('Note changed. Reload before saving'))
    await action
    expect(next).not.toHaveBeenCalled()
    expect(h.saveTone).toHaveBeenCalledTimes(1)
    expect(h.version()).toBe('v1')
    await h.result.current.run(next)
    expect(next).toHaveBeenCalledOnce()
    expect(h.saveTone).toHaveBeenCalledTimes(2)
  })

  it('chains several captured tone edits using the version at execution', async () => {
    const tone = deferred<{ data: { updated_at: string; tone_hint: string | null } }>()
    const h = setup()
    h.saveTone.mockReturnValueOnce(tone.promise)
    act(() => h.result.current.saveTone())
    h.rerender({ toneHint: 'Detailed' })
    act(() => h.result.current.saveTone())
    const action = h.result.current.run(async () => {})
    tone.resolve({ data: { updated_at: 'v2', tone_hint: 'Concise' } })
    await action
    expect(h.saveTone.mock.calls).toEqual([['Concise', 'v1'], ['Detailed', 'v2']])
  })

  it('queues tone behind an explicit mutation and never interleaves save and sign', async () => {
    const h = setup()
    h.rerender({ toneHint: '' })
    const saving = deferred<void>()
    const action = h.result.current.run(async () => { await saving.promise; h.setVersion('v3') })
    await Promise.resolve()
    h.rerender({ toneHint: 'Detailed' })
    act(() => h.result.current.saveTone())
    expect(h.saveTone).not.toHaveBeenCalled()
    saving.resolve()
    await action
    await waitFor(() => expect(h.saveTone).toHaveBeenCalledWith('Detailed', 'v3'))
  })
})
