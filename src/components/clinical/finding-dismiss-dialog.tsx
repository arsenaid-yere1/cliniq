'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { dismissFinding } from '@/actions/case-quality-reviews'

export function FindingDismissDialog({
  caseId,
  hash,
  onClose,
}: {
  caseId: string
  hash: string
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const onConfirm = () =>
    startTransition(async () => {
      const r = await dismissFinding(caseId, hash, {
        dismissed_reason: reason.trim() || null,
      })
      if (r.error) toast.error(r.error)
      else {
        toast.success('Finding dismissed')
        onClose()
        router.refresh()
      }
    })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dismiss finding</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="dismiss-reason">Reason (optional)</Label>
          <Textarea
            id="dismiss-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this not actually an issue?"
          />
          <p className="text-xs text-muted-foreground">
            Dismissed findings are hidden from the active list but stay
            recoverable until the next Recheck.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
