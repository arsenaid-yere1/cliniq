import { z } from 'zod'

export const MAX_DIAGNOSTICS_BYTES = 16 * 1024
const MAX_EXCERPT = 1000

// JSON/JSONB must not receive a lone surrogate when an excerpt crosses an emoji.
function sliceExcerpt(text: string, requestedStart: number, length: number) {
  let start = requestedStart
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start] ?? '') && /[\uD800-\uDBFF]/.test(text[start - 1])) start--
  let end = Math.min(text.length, start + length)
  if (end > start && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end] ?? '')) end--
  return { text: text.slice(start, end), start }
}
const matchSchema = z.object({
  rule: z.enum(['current_decision', 'continued_decision', 'passive_decision', 'agreement', 'procedure_consent', 'unsupported_telehealth_consent']),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  sourceKey: z.string().optional(),
})

export interface ValidationDiagnostic {
  code: string
  path: string[]
  rule: string | null
  excerpt: string | null
  excerptStart: number | null
  matchStart: number | null
  matchEnd: number | null
  truncated: boolean
}

export interface ValidationFailure {
  failureOrdinal: number
  validationAttempt: number
  model: string
  issues: ValidationDiagnostic[]
}
export type ValidationFailureHook = (failure: ValidationFailure) => void | Promise<void>

/** Bounded original text, never normalized/masked matching text. */
export function collectValidationDiagnostics(error: z.ZodError, raw: Record<string, unknown>): ValidationDiagnostic[] {
  return error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.slice(0, 8).map((part) => String(part).slice(0, 80))
    const diagnostic: ValidationDiagnostic = {
      code: issue.code, path, rule: null, excerpt: null, excerptStart: null,
      matchStart: null, matchEnd: null, truncated: false,
    }
    const parsed = matchSchema.safeParse(issue.code === 'custom' ? issue.params?.visitDecision : null)
    if (!parsed.success) return diagnostic
    const { start, end, rule, sourceKey } = parsed.data
    const original = raw[sourceKey ?? String(issue.path[0])]
    if (typeof original !== 'string' || start >= end || end > original.length) return diagnostic
    const room = Math.max(0, MAX_EXCERPT - (end - start))
    const slice = sliceExcerpt(original, Math.max(0, start - Math.floor(room / 2)), MAX_EXCERPT)
    const excerptStart = slice.start
    const excerpt = slice.text
    return { ...diagnostic, rule, excerpt, excerptStart, matchStart: start, matchEnd: end,
      truncated: excerptStart > 0 || excerpt.length < original.length }
  })
}

/** SQL receives JSON text so the server can enforce this same wire-byte bound. */
export function serializeValidationFailure(failure: ValidationFailure): string {
  const bounded: ValidationFailure = { ...failure, issues: failure.issues.map((issue) => ({ ...issue, path: [...issue.path] })) }
  let serialized = JSON.stringify(bounded)
  while (new TextEncoder().encode(serialized).length > MAX_DIAGNOSTICS_BYTES) {
    const issue = bounded.issues.reduce((largest, next) =>
      (next.excerpt?.length ?? 0) > (largest.excerpt?.length ?? 0) ? next : largest)
    if (!issue?.excerpt) throw new Error('Diagnostic metadata exceeds limit')
    const oldStart = issue.excerptStart ?? 0
    const length = Math.floor(issue.excerpt.length / 2)
    const relativeMatch = Math.max(0, (issue.matchStart ?? oldStart) - oldStart)
    const start = Math.max(0, Math.min(relativeMatch, issue.excerpt.length - length))
    const slice = sliceExcerpt(issue.excerpt, start, length)
    issue.excerpt = slice.text
    issue.excerptStart = oldStart + slice.start
    issue.truncated = true
    serialized = JSON.stringify(bounded)
  }
  return serialized
}
