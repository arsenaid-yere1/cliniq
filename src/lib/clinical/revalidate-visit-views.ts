import 'server-only'
import { revalidatePath } from 'next/cache'

/** Refresh the hub and affected editor without remounting every case form on a draft save. */
export function revalidateVisitViews(caseId: string, family: 'evaluation' | 'discharge' | 'follow_up', options: {
  encounterId?: string; episodeTransition?: boolean; dischargeDateChanged?: boolean
} = {}) {
  const base = `/patients/${caseId}`
  revalidatePath(`${base}/visits`)
  if (family === 'evaluation') revalidatePath(`${base}/initial-visit`)
  if (family === 'discharge') revalidatePath(`${base}/discharge`)
  if (family === 'follow_up' && options.encounterId) revalidatePath(`${base}/visits/${options.encounterId}`)
  if (options.episodeTransition) revalidatePath(base, 'layout')
  if (options.dischargeDateChanged) revalidatePath('/patients')
}
