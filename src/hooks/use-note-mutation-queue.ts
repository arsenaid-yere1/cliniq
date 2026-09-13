'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'

interface MutationContext {
  isActive: () => boolean
  finish: () => void
}
interface QueueScope {
  active: boolean
  writable: boolean
  terminal: boolean
  tail: Promise<unknown>
}

/** Serialize writes within one mounted draft. Cancellation only skips unstarted work. */
export function useNoteMutationQueue(identity: string, writable: boolean) {
  const scope = useRef<QueueScope | null>(null)
  useLayoutEffect(() => {
    const current: QueueScope = { active: true, writable: true, terminal: false, tail: Promise.resolve() }
    scope.current = current
    return () => { current.active = false }
  }, [identity])
  useLayoutEffect(() => {
    if (scope.current) scope.current.writable = writable
  }, [identity, writable])

  const enqueue = useCallback(<T,>(task: (context: MutationContext) => Promise<T>): Promise<T | undefined> => {
    const current = scope.current
    if (!current) return Promise.resolve(undefined)
    const isActive = () => current.active && current.writable && !current.terminal
    const result = current.tail.then(() => {
      if (!isActive()) return undefined
      return task({ isActive, finish: () => { current.terminal = true } })
    })
    // A failed task must reject for its caller, but must not poison future retries.
    current.tail = result.catch(() => undefined)
    return result
  }, [])
  return { enqueue }
}

type ToneResult = { data?: { updated_at: string; tone_hint: string | null }; error?: string }
const normalizeTone = (tone: string | null) => tone?.trim() || null

/** Tone blur and explicit actions share the same queue and acknowledged version. */
export function useDraftNoteMutations(options: {
  identity: string
  writable: boolean
  toneHint: string
  initialTone: string | null
  getVersion: () => string | null | undefined
  acknowledgeVersion: (expected: string, saved: string) => void
  saveTone: (tone: string | null, expected: string) => Promise<ToneResult>
  onError: (message: string) => void
}) {
  const { enqueue } = useNoteMutationQueue(options.identity, options.writable)
  const persistedTone = useRef(normalizeTone(options.initialTone))
  const latestTone = useRef<{ promise: Promise<void | undefined>; settled: boolean } | null>(null)
  useLayoutEffect(() => {
    persistedTone.current = normalizeTone(options.initialTone)
    latestTone.current = null
    // Incoming prop versions must not reset our own acknowledged tone baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.identity])

  function report(error: unknown) {
    options.onError(error instanceof Error ? error.message : 'Something went wrong. Please try again.')
  }

  async function flushTone(tone: string | null, context: MutationContext) {
    if (!context.isActive() || tone === persistedTone.current) return
    const expected = options.getVersion()
    if (!expected) throw new Error('Reload the note before saving tone guidance.')
    const result = await options.saveTone(tone, expected)
    if (!context.isActive()) return
    if (result.error) throw new Error(result.error)
    if (!result.data?.updated_at) throw new Error('Unable to confirm the saved tone version. Reload the note.')
    options.acknowledgeVersion(expected, result.data.updated_at)
    persistedTone.current = result.data.tone_hint
  }

  function saveTone() {
    const tone = normalizeTone(options.toneHint)
    const request = { promise: enqueue((context) => flushTone(tone, context)), settled: false }
    latestTone.current = request
    void request.promise.then(
      () => { request.settled = true },
      (error) => { request.settled = true; report(error) },
    )
  }

  function run(task: (context: MutationContext) => Promise<void>) {
    // A click already waiting for a blur must observe its failure, not retry it.
    // A later user action may retry the still-dirty tone after that failure settles.
    const dependency = latestTone.current
    const pendingTone = dependency && !dependency.settled ? dependency.promise : null
    const tone = normalizeTone(options.toneHint)
    return enqueue(async (context) => {
      if (pendingTone) await pendingTone
      await flushTone(tone, context)
      if (context.isActive()) await task(context)
    }).catch(report)
  }

  return { saveTone, run }
}
