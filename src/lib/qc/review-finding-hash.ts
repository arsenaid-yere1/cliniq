import 'server-only'
import { createHash } from 'node:crypto'
import type { QualityFinding } from '@/lib/validations/case-quality-review'

// Stable hash for a finding — used as the key into FindingOverridesMap.
// Inputs are exactly the fields a regen would re-emit identically when the
// underlying drift has not changed; messages reordered or slightly reworded
// will hash differently, which is acceptable: the override layer is wiped
// on regen anyway.
export function computeFindingHash(finding: QualityFinding): string {
  if (finding.key) return finding.key
  if (finding.encounter_id) {
    const versioned = ['v2', finding.severity, finding.step, finding.note_id ?? '', finding.procedure_id ?? '', finding.encounter_id, finding.section_key ?? '', finding.message].join('|')
    return createHash('sha256').update(versioned).digest('hex')
  }
  const parts = [
    finding.severity,
    finding.step,
    finding.note_id ?? '',
    finding.procedure_id ?? '',
    finding.section_key ?? '',
    finding.message,
  ].join('|')
  return createHash('sha256').update(parts).digest('hex')
}
