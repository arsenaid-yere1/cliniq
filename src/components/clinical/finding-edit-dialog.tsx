'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { editFinding } from '@/actions/case-quality-reviews'

export function FindingEditDialog({
  caseId,
  hash,
  initialValues,
  onClose,
}: {
  caseId: string
  hash: string
  initialValues: {
    edited_message: string
    edited_rationale: string | null
    edited_suggested_tone_hint: string | null
  }
  onClose: () => void
}) {
  const [message, setMessage] = useState(initialValues.edited_message)
  const [rationale, setRationale] = useState(initialValues.edited_rationale ?? '')
  const [toneHint, setToneHint] = useState(initialValues.edited_suggested_tone_hint ?? '')
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) {
      toast.error('Message is required')
      return
    }
    startTransition(async () => {
      const r = await editFinding(caseId, hash, {
        edited_message: message.trim(),
        edited_rationale: rationale.trim() || null,
        edited_suggested_tone_hint: toneHint.trim() || null,
      })
      if (r.error) toast.error(r.error)
      else {
        toast.success('Finding edited')
        onClose()
      }
    })
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit finding</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="edit-message">Message</Label>
            <Input
              id="edit-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-rationale">Rationale</Label>
            <Textarea
              id="edit-rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-tone">Suggested tone hint</Label>
            <Textarea
              id="edit-tone"
              value={toneHint}
              onChange={(e) => setToneHint(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
