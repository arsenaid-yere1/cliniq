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

export function validateTelehealthFollowUpOutput(note: PainFollowUpNoteResult) {
  const currentExamText = [note.telehealth_observations, note.assessment].join('\n')
  const handsOn = UNSUPPORTED_HANDS_ON_PATTERNS.find((pattern) => pattern.test(currentExamText))
  if (handsOn) return { error: 'Telehealth note contains an unsupported hands-on examination finding' }
  const vital = UNSUPPORTED_CURRENT_VITALS.find((pattern) => pattern.test(currentExamText))
  if (vital) return { error: 'Telehealth note contains unsupported current-visit vital signs' }
  return { data: note }
}
