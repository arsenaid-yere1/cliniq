'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

/**
 * Client-side progress surface for AI note generation.
 *
 * Renders a live elapsed-time counter + "still working" message while a note
 * row is in `status = 'generating'`. Polls the router (which re-fetches the
 * server component tree) every `pollIntervalMs` so that when the server action
 * completes and transitions the row to 'draft' or 'failed', the UI rerenders
 * the appropriate state WITHOUT requiring the provider to refresh or
 * navigate.
 *
 * Section-level progress (optional):
 * - When `noteId` + `realtimeTable` are provided, the component subscribes to
 *   Supabase Realtime UPDATEs on that row and renders a `{done}/{total}` line
 *   alongside the elapsed timer. Requires the table to be in the
 *   `supabase_realtime` publication (initial_visit_notes is, as of 20260429).
 * - `initialProgress` seeds the counter from the server-rendered row so the
 *   UI isn't blank before the first realtime event lands.
 * - Router polling continues as a fallback at a slower cadence when realtime
 *   is active — covers reconnect gaps + the final status transition, which
 *   the server component tree still needs a refresh to pick up.
 *
 * Historical note on polling vs SSE: tool-use JSON is only parseable at
 * message_stop, so token-level streaming is not a viable UX for the current
 * generators. Section progress via DB + realtime gives the same "work
 * happening" signal without a backend refactor.
 *
 * Defaults: poll every 3s while visible, cap displayed elapsed at 180s so
 * the counter doesn't grow unboundedly on pathological stalls.
 */
export function GeneratingProgress({
  pollIntervalMs,
  startedAt,
  noteId,
  realtimeTable,
  initialProgress,
}: {
  pollIntervalMs?: number
  // ISO string from the note row's updated_at at the moment status became
  // 'generating'. If the row has been in 'generating' state across a page
  // refresh, this preserves the original elapsed time instead of restarting
  // the counter.
  startedAt?: string | null
  noteId?: string
  realtimeTable?: string
  initialProgress?: { done: number; total: number } | null
}) {
  const router = useRouter()
  const [elapsedMs, setElapsedMs] = useState(0)
  const [progress, setProgress] = useState(initialProgress ?? null)

  const realtimeActive = Boolean(noteId && realtimeTable)
  const effectivePollMs = pollIntervalMs ?? (realtimeActive ? 10000 : 3000)

  useEffect(() => {
    // Origin is captured on mount. For a row that was already in 'generating'
    // state when the page loaded, startedAt (the row's updated_at) is used so
    // the counter reflects real elapsed time rather than restarting at 0.
    const origin = startedAt ? new Date(startedAt).getTime() : Date.now()
    const tick = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - origin))
    }, 1000)
    const poll = setInterval(() => {
      router.refresh()
    }, effectivePollMs)
    return () => {
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [startedAt, effectivePollMs, router])

  useEffect(() => {
    if (!noteId || !realtimeTable) return
    const supabase = createClient()
    const channel = supabase
      .channel(`note-progress-${noteId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: realtimeTable,
          filter: `id=eq.${noteId}`,
        },
        (payload) => {
          const row = payload.new as { sections_done?: number; sections_total?: number } | null
          if (!row) return
          if (typeof row.sections_done === 'number' && typeof row.sections_total === 'number') {
            setProgress({ done: row.sections_done, total: row.sections_total })
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [noteId, realtimeTable])

  const displaySeconds = Math.min(180, Math.floor(elapsedMs / 1000))
  const note =
    displaySeconds < 20
      ? 'Starting generation…'
      : displaySeconds < 60
        ? 'Working through the sections…'
        : displaySeconds < 120
          ? 'Still generating — complex cases can take a minute or two.'
          : 'Generation is taking longer than usual. This may indicate an upstream delay.'

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30 text-sm"
    >
      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
      <div className="flex flex-col">
        <span className="font-medium">
          Generating note… ({displaySeconds}s)
        </span>
        <span className="text-muted-foreground">{note}</span>
        {progress && progress.total > 0 ? (
          <span className="text-muted-foreground">
            {progress.done}/{progress.total} sections drafted
          </span>
        ) : null}
      </div>
    </div>
  )
}
