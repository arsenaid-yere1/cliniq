// Post-generation numeric consistency validator for discharge notes.
//
// The LLM now receives a TS-assembled `painTrajectoryText` and a
// `dischargeVisitPainDisplay` to render verbatim. This module cross-checks
// the emitted note against the deterministic trajectory and returns
// non-fatal warnings. Warnings are stashed into `raw_ai_response` for
// observability — they are NOT hard-blocks today.

import type { DischargeNoteResult } from '@/lib/validations/discharge-note'
import type { DischargePainTrajectory } from '@/lib/claude/pain-trajectory'

export interface TrajectoryValidationResult {
  warnings: string[]
  dischargeReadingsFound: Array<{ section: string; value: string }>
}

// Matches "N/10" or "N-M/10" with a word boundary on the left side. The
// right side must be followed by "/10" — avoids eating date strings like
// "05/10/2025" because the prefix "05" is followed by "/10/" not "/10".
const PAIN_PATTERN = /(\d{1,2}(?:-\d{1,2})?)\/10(?!\d|\/)/g

const TRAJECTORY_SECTIONS: Array<keyof DischargeNoteResult> = [
  'subjective',
  'objective_vitals',
  'assessment',
  'prognosis',
]

function extractPainReadings(text: string): string[] {
  const out: string[] = []
  if (!text) return out
  for (const match of text.matchAll(PAIN_PATTERN)) {
    out.push(match[1])
  }
  return out
}

function normalizeDisplay(display: string | null): string | null {
  if (!display) return null
  return display.replace(/\/10$/, '')
}

function collectExpectedValues(trajectory: DischargePainTrajectory): Set<string> {
  const values = new Set<string>()
  for (const entry of trajectory.entries) {
    if (entry.min != null && entry.max != null) {
      if (entry.min === entry.max) values.add(`${entry.min}`)
      else values.add(`${entry.min}-${entry.max}`)
    } else if (entry.max != null) {
      values.add(`${entry.max}`)
    } else if (entry.min != null) {
      values.add(`${entry.min}`)
    }
  }
  const baseline = normalizeDisplay(trajectory.baselineDisplay)
  if (baseline) values.add(baseline)
  const discharge = normalizeDisplay(trajectory.dischargeDisplay)
  if (discharge) values.add(discharge)
  return values
}

export function validateDischargeTrajectoryConsistency(
  result: DischargeNoteResult,
  trajectory: DischargePainTrajectory,
): TrajectoryValidationResult {
  const warnings: string[] = []
  const dischargeReadingsFound: Array<{ section: string; value: string }> = []

  // When there is no deterministic trajectory there is nothing to check —
  // the legacy prompt path was used and free-form numbers are expected.
  if (trajectory.entries.length === 0 && !trajectory.dischargeDisplay) {
    return { warnings, dischargeReadingsFound }
  }

  const expected = collectExpectedValues(trajectory)
  const dischargeValue = normalizeDisplay(trajectory.dischargeDisplay)

  for (const section of TRAJECTORY_SECTIONS) {
    const content = result[section] ?? ''
    const readings = extractPainReadings(content)
    for (const r of readings) {
      dischargeReadingsFound.push({ section, value: `${r}/10` })
      if (!expected.has(r)) {
        warnings.push(
          `Section "${section}" contains pain value ${r}/10 that is not in the deterministic trajectory (expected one of: ${Array.from(expected).map((v) => `${v}/10`).join(', ')}).`,
        )
      }
    }
  }

  if (dischargeValue) {
    const dischargeClause = `${dischargeValue}/10`
    const bullet = result.objective_vitals ?? ''
    if (bullet.trim().length > 0 && !bullet.includes(dischargeClause)) {
      warnings.push(
        `objective_vitals Pain bullet does not contain the deterministic discharge reading ${dischargeClause}.`,
      )
    }
    for (const section of ['subjective', 'assessment', 'prognosis'] as const) {
      const content = result[section] ?? ''
      if (content.trim().length > 0 && !content.includes(dischargeClause)) {
        warnings.push(
          `Section "${section}" does not contain the deterministic discharge reading ${dischargeClause}.`,
        )
      }
    }
  }

  if (trajectory.arrowChain && result.subjective && !result.subjective.includes(trajectory.arrowChain)) {
    warnings.push(
      'subjective does not contain the verbatim painTrajectoryText arrow chain — LLM likely paraphrased.',
    )
  }

  return { warnings, dischargeReadingsFound }
}
