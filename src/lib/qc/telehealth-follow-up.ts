import type { PainFollowUpNoteResult } from '@/lib/validations/pain-follow-up-note'

const UNSUPPORTED_HANDS_ON_PATTERNS = [
  /\bpalpation\b/i,
  /\b(?:motor|strength)\s+(?:is\s+)?[0-5]\s*\/\s*5\b/i,
  /\b(?:deep tendon )?reflex(?:es)?\b/i,
  /\brange of motion\b.{0,40}\b\d+\s*(?:°|degrees?)\b/i,
  /\bmanual muscle test/i,
]

const UNSUPPORTED_CURRENT_VITALS = [
  /\bblood pressure\b|\bBP\s*[:=]?\s*\d+/i,
  /\bheart rate\b|\bpulse\s*[:=]?\s*\d+/i,
  /\bSpO2\b|\boxygen saturation\b/i,
  /\btemperature\s*[:=]?\s*\d+/i,
]

const NON_CURRENT_OR_UNPERFORMED = [
  /\b(?:prior|previous|historical|earlier)\b/i,
  /\b(?:was|were|is|are)?\s*not\s+(?:performed|assessed|tested|measured|obtained)\b/i,
  /\b(?:could|can)\s+not\s+be\s+(?:performed|assessed|tested|measured|obtained)\b/i,
  /\b(?:deferred|unable to assess|limited by telehealth|telehealth limitation)\b/i,
  /\bno\b.{0,40}\b(?:performed|assessed|tested|measured|obtained)\b/i,
]

const PATIENT_REPORTED_CONTEXT =
  /\b(?:patient[- ]reported|patient reports?|reported at home|home reading)\b/i

function segments(text: string) {
  return text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean)
}

function isNonCurrentOrUnperformed(segment: string) {
  return NON_CURRENT_OR_UNPERFORMED.some((pattern) => pattern.test(segment))
}

export function validateTelehealthFollowUpOutput(note: PainFollowUpNoteResult) {
  const currentExamText = [note.telehealth_observations, note.assessment].join('\n')
  const examSegments = segments(currentExamText)
  const handsOn = examSegments.find((segment) =>
    !isNonCurrentOrUnperformed(segment)
    && UNSUPPORTED_HANDS_ON_PATTERNS.some((pattern) => pattern.test(segment)),
  )
  if (handsOn) return { error: 'Telehealth note contains an unsupported hands-on examination finding' }
  const vital = examSegments.find((segment) =>
    !isNonCurrentOrUnperformed(segment)
    && !PATIENT_REPORTED_CONTEXT.test(segment)
    && UNSUPPORTED_CURRENT_VITALS.some((pattern) => pattern.test(segment)),
  )
  if (vital) return { error: 'Telehealth note contains unsupported current-visit vital signs' }
  return { data: note }
}
