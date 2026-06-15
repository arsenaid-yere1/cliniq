'use client'

import { useTransition, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { updateCaseStatus } from '@/actions/case-status'
import { CASE_STATUS_CONFIG, CASE_STATUS_TRANSITIONS, CASE_STATUSES, type CaseStatus } from '@/lib/constants/case-status'

interface StatusChangeDropdownProps {
  caseId: string
  currentStatus: CaseStatus
  isAdmin?: boolean
}

export function StatusChangeDropdown({ caseId, currentStatus, isAdmin = false }: StatusChangeDropdownProps) {
  const [isPending, startTransition] = useTransition()
  const [confirmStatus, setConfirmStatus] = useState<CaseStatus | null>(null)
  // Track whether the pending confirmation is an admin override (so we pass the flag through).
  const [confirmOverride, setConfirmOverride] = useState(false)

  const allowedTransitions = CASE_STATUS_TRANSITIONS[currentStatus] ?? []
  // Non-admins with no normal transitions see nothing; admins always get the override menu.
  if (allowedTransitions.length === 0 && !isAdmin) return null

  // Admin override targets: every status except the current one and the ones already
  // offered as a normal transition (avoid duplicate entries).
  const overrideTargets = isAdmin
    ? CASE_STATUSES.filter((s) => s !== currentStatus && !allowedTransitions.includes(s))
    : []

  const currentConfig = CASE_STATUS_CONFIG[currentStatus]

  function requestChange(status: CaseStatus, override: boolean) {
    setConfirmOverride(override)
    setConfirmStatus(status)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Change Status
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {allowedTransitions.map((status) => {
            const config = CASE_STATUS_CONFIG[status]
            return (
              <DropdownMenuItem key={status} onClick={() => requestChange(status, false)}>
                <Badge variant={config.variant} className={`${config.color} mr-2`}>
                  {config.label}
                </Badge>
              </DropdownMenuItem>
            )
          })}
          {isAdmin && overrideTargets.length > 0 && (
            <>
              {allowedTransitions.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Override (admin)
              </DropdownMenuLabel>
              {overrideTargets.map((status) => {
                const config = CASE_STATUS_CONFIG[status]
                return (
                  <DropdownMenuItem key={status} onClick={() => requestChange(status, true)}>
                    <Badge variant={config.variant} className={`${config.color} mr-2`}>
                      {config.label}
                    </Badge>
                  </DropdownMenuItem>
                )
              })}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={!!confirmStatus} onOpenChange={(open) => !open && setConfirmStatus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Case Status</AlertDialogTitle>
            <AlertDialogDescription>
              Change status from {currentConfig.label} to {confirmStatus ? CASE_STATUS_CONFIG[confirmStatus].label : ''}?
              {(confirmStatus === 'closed' || confirmStatus === 'archived') &&
                ' This will prevent further modifications to the case.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmStatus) return
                const target = confirmStatus
                const override = confirmOverride
                setConfirmStatus(null)
                startTransition(async () => {
                  const result = await updateCaseStatus(
                    caseId,
                    target,
                    undefined,
                    override ? { override: true } : undefined,
                  )
                  if (result.error) toast.error(result.error)
                  else toast.success(`Status changed to ${CASE_STATUS_CONFIG[target].label}`)
                })
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
