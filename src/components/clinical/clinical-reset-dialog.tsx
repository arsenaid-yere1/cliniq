'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { applyClinicalReset, previewClinicalReset } from '@/actions/clinical-reset'
import { clinicalNoteLabel, type ClinicalNoteKind, type ClinicalResetPreview, type ClinicalResetRequest } from '@/lib/validations/clinical-reset'

interface Props {
  caseId: string
  target?: { kind: ClinicalNoteKind; id: string }
  keepContent?: boolean
  disabled?: boolean
}

export function ClinicalResetDialog({ caseId, target, keepContent = false, disabled = false }: Props) {
  const router = useRouter()
  const reasonId = useId()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<ClinicalResetPreview>()
  const [selected, setSelected] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [request, setRequest] = useState<ClinicalResetRequest>()
  const key = (n: { kind: string; id: string }) => `${n.kind}:${n.id}`
  const reactivate = !target || !!preview && (preview.episode_status !== 'active' || ['pending_settlement', 'closed', 'archived'].includes(preview.case_status))
  const chosen = preview?.notes.filter(n => selected.includes(key(n))) ?? []
  const requiresAdmin = reactivate || chosen.some(n => n.status === 'finalized') || keepContent
  const blocked = !preview || preview.open_correction || preview.episode_status === 'cancelled'
    || (reactivate && !preview.latest_episode) || (requiresAdmin && !preview.is_admin)
    || chosen.some(n => n.blockers.length > 0 || !['draft', 'failed', 'finalized'].includes(n.status))
    || (!!target && chosen.length !== 1) || (!reactivate && !chosen.length) || (requiresAdmin && reason.trim().length < 10)
  const title = reactivate ? 'Reactivate case' : keepContent ? 'Edit signed note' : 'Reset note'

  async function load() {
    setPending(true)
    setError(undefined)
    setRequest(undefined)
    try {
      const result = await previewClinicalReset(caseId, undefined, target)
      if (!result.data) { setError(result.error); setPreview(undefined); return }
      setPreview(result.data)
      setSelected(target ? [key(target)] : [])
    } catch { setError('Unable to load the preview. Try again.'); setPreview(undefined) }
    finally { setPending(false) }
  }

  async function submit() {
    if (!preview || blocked) return
    const input = request ?? {
      case_id: caseId, episode_id: preview.episode_id,
      case_version: preview.case_version, episode_version: preview.episode_version,
      reactivate, reason: reason.trim(), request_key: crypto.randomUUID(),
      notes: chosen.map(n => ({ kind: n.kind, id: n.id, updated_at: n.updated_at, keep_content: keepContent })),
    }
    setRequest(input)
    setPending(true)
    try {
      const result = await applyClinicalReset(input)
      if ('error' in result) { setError(result.error); return }
      toast.success(reactivate ? 'Case reactivated' : keepContent ? 'Note reopened for editing' : 'Note reset')
      setOpen(false)
      router.refresh()
    } catch { setError('Unable to confirm the result. Retry to check this operation safely.') }
    finally { setPending(false) }
  }

  return <>
    <Button variant="outline" disabled={disabled} onClick={() => { setOpen(true); setReason(''); void load() }}>
      {!target ? 'Reactivate case' : keepContent ? 'Edit' : 'Reset'}
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value) }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {keepContent ? 'Reopen this signed note for editing while retaining its text and signed history.' : 'Reset clears the selected generated notes for a fresh start. Intake, vitals, performed procedures, and billing records are preserved.'}
          </DialogDescription>
        </DialogHeader>
        {preview && <div className="space-y-4">
          <p className="text-sm">Episode {preview.episode_number} · {preview.episode_status}</p>
          {preview.reopened && <p className="text-sm text-muted-foreground">This episode has been reopened. Its earlier discharge remains in the document history.</p>}
          {reactivate && <p className="text-sm">The case and this episode will become Active. {chosen.length ? `${chosen.length} selected note(s) will also be reset.` : 'No notes will be reset.'}</p>}
          {target && !chosen.length && <p role="alert">This note is no longer available. Refresh the preview.</p>}
          {preview.open_correction && <p role="alert">Finish or cancel the open discharge correction first.</p>}
          {reactivate && !preview.latest_episode && <p role="alert">A newer episode exists. This older episode cannot be reactivated.</p>}
          {preview.episode_status === 'cancelled' && <p role="alert">Cancelled episodes cannot be reactivated.</p>}
          {requiresAdmin && !preview.is_admin && <p role="alert">An administrator is required for this operation.</p>}
          <fieldset disabled={pending || !!request} className="space-y-3">
            <legend className="mb-2 text-sm font-medium">{target ? 'Selected note' : 'Optional notes to reset'}</legend>
            {preview.notes.filter(n => !target || key(n) === key(target)).map(n => <div key={key(n)} className="rounded-md border p-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={selected.includes(key(n))}
                  disabled={!!target || n.blockers.length > 0 || !['draft', 'failed', 'finalized'].includes(n.status) || (n.status === 'finalized' && !preview.is_admin)}
                  onChange={event => { setRequest(undefined); setSelected(s => event.target.checked ? [...s, key(n)] : s.filter(k => k !== key(n))) }} />
                {clinicalNoteLabel(n)} · {n.status}
              </label>
              {n.blockers.map(b => <p key={`${b.kind}:${b.id}`} className="mt-2">
                {b.message}. <Link className="underline" href={b.kind === 'billing' ? `/patients/${caseId}/billing/${b.id}` : `/patients/${caseId}/procedures`}>View {b.kind === 'billing' ? 'invoice' : 'order'}</Link>
              </p>)}
            </div>)}
          </fieldset>
          {chosen.some(n => n.status === 'finalized') && <p className="text-sm text-muted-foreground">The signed content and PDF will remain in history. A finalized replacement will supersede the earlier version.</p>}
          <div className="space-y-2">
            <label htmlFor={reasonId} className="text-sm font-medium">Reason {requiresAdmin ? '(required, at least 10 characters)' : '(optional)'}</label>
            <Textarea id={reasonId} value={reason} maxLength={1000} disabled={pending || !!request} onChange={e => setReason(e.target.value)} />
          </div>
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
          {error && <Button variant="outline" disabled={pending} onClick={() => void load()}>Refresh preview</Button>}
          <Button disabled={pending || blocked} onClick={() => void submit()}>{pending ? 'Please wait…' : title}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
