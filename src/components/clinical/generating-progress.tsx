'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

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
 * Why polling over SSE/streaming:
 * - Current generators use tool-use forcing for clinical-safety Zod validation.
 *   Tool-use output is inherently all-or-nothing at the model level — the
 *   tool_use.input JSON only becomes parseable at message_stop. Streaming
 *   offers no mid-flight payload to render.
 * - Next.js server actions don't natively stream to client. True streaming
 *   requires route handlers + SSE/ReadableStream + partial-write durability
 *   — multi-session refactor with low net clinical benefit.
 *
 * Polling a single status column (cheap indexed read) delivers the same UX
 * win — provider knows work is in flight, sees elapsed time, UI transitions
 * automatically on completion — without the backend refactor.
 *
 * Defaults: poll every 3s while visible, cap displayed elapsed at 180s so
 * the counter doesn't grow unboundedly on pathological stalls.
 */
export function GeneratingProgress({
  pollIntervalMs = 3000,
  startedAt,
}: {
  pollIntervalMs?: number
  // ISO string from the note row's updated_at at the moment status became
  // 'generating'. If the row has been in 'generating' state across a page
  // refresh, this preserves the original elapsed time instead of restarting
  // the counter.
  startedAt?: string | null
}) {
  const router = useRouter()
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    // Origin is captured on mount. For a row that was already in 'generating'
    // state when the page loaded, startedAt (the row's updated_at) is used so
    // the counter reflects real elapsed time rather than restarting at 0.
    const origin = startedAt ? new Date(startedAt).getTime() : Date.now()
    // Tick once per second; the first tick at t=0 also updates the initial
    // elapsed reading, which avoids a sync setState inside the effect body.
    const tick = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - origin))
    }, 1000)
    // Poll the router for fresh server-component data.
    const poll = setInterval(() => {
      router.refresh()
    }, pollIntervalMs)
    return () => {
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [startedAt, pollIntervalMs, router])

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
      </div>
    </div>
  )
}
