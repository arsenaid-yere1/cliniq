import type { ClinicalEncounterType } from '@/lib/constants/clinical-encounter'

export function visitsHref(caseId: string, episodeId?: string) {
  return `/patients/${encodeURIComponent(caseId)}/visits${episodeId ? `?episode=${encodeURIComponent(episodeId)}` : ''}`
}

export function visitHref(caseId: string, episodeId: string, kind: ClinicalEncounterType, encounterId?: string | null) {
  const base = `/patients/${encodeURIComponent(caseId)}`
  const episode = encodeURIComponent(episodeId)
  if (kind === 'pain_follow_up') return encounterId ? `${base}/visits/${encodeURIComponent(encounterId)}` : null
  if (kind === 'discharge') return `${base}/discharge?episode=${episode}`
  return `${base}/initial-visit?episode=${episode}&visitType=${kind === 'pain_evaluation' ? 'pain_evaluation_visit' : 'initial_visit'}`
}

export function isVisitsPath(pathname: string, caseId: string) {
  return ['visits', 'initial-visit', 'discharge'].some(segment => {
    const path = `/patients/${encodeURIComponent(caseId)}/${segment}`
    return pathname === path || pathname.startsWith(`${path}/`)
  })
}
