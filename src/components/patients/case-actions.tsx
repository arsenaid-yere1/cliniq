'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Lock, Unlock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { closeCase, reopenCase } from '@/actions/case-status'

interface CaseActionsProps {
  caseId: string
  caseStatus: string
}

export function CaseActions({ caseId, caseStatus }: CaseActionsProps) {
  const [isPending, startTransition] = useTransition()

  if (caseStatus === 'closed') {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Unlock className="h-4 w-4 mr-2" />}
            Reopen Case
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen Case</AlertDialogTitle>
            <AlertDialogDescription>
              This will reopen the case and allow modifications. The case status will change from Closed to Active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                startTransition(async () => {
                  const result = await reopenCase(caseId)
                  if (result.error) toast.error(result.error)
                  else toast.success('Case reopened')
                })
              }}
            >
              Reopen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
          Close Case
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close Case</AlertDialogTitle>
          <AlertDialogDescription>
            Closing the case will prevent any further modifications. Documents and notes will remain viewable. A finalized discharge summary is required. You can reopen the case later if needed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              startTransition(async () => {
                const result = await closeCase(caseId)
                if (result.error) toast.error(result.error)
                else toast.success('Case closed')
              })
            }}
          >
            Close Case
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
