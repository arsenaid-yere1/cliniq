import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { visitsHref } from '@/lib/clinical/visit-routes'

export function VisitEditorHeader({ caseId, episodeId, episodeNumber, readOnly = false }: { caseId: string; episodeId: string; episodeNumber?: number; readOnly?: boolean }) {
  return <div className="mb-6 flex flex-wrap items-center gap-3 border-b pb-4 text-sm">
    <Link href={visitsHref(caseId, episodeId)} className="inline-flex items-center gap-2 font-medium text-primary hover:underline"><ArrowLeft aria-hidden="true" className="size-4" />All visits</Link>
    <span className="text-muted-foreground">{episodeNumber ? `Episode ${episodeNumber}` : 'Selected care episode'}</span>
    {readOnly && <span className="rounded border px-2 py-0.5 text-muted-foreground">Read only</span>}
  </div>
}
