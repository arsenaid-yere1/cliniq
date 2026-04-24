'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { markInvoicePaid, recordPayment } from '@/actions/invoice-status'

export type PaymentDialogMode = 'mark-paid' | 'record-payment'

interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: PaymentDialogMode
  invoiceId: string
  totalAmount: number
  paidAmount: number
}

const PAYMENT_METHODS = ['Check', 'Card', 'Cash', 'Settlement', 'Other']

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function formatCurrency(n: number) {
  return `$${n.toFixed(2)}`
}

export function PaymentDialog(props: PaymentDialogProps) {
  // Re-mount form state each time the dialog opens by keying on `open`.
  // Parent already controls open state; when it flips true, we get fresh defaults.
  return <PaymentDialogInner key={props.open ? 'open' : 'closed'} {...props} />
}

function PaymentDialogInner({
  open,
  onOpenChange,
  mode,
  invoiceId,
  totalAmount,
  paidAmount,
}: PaymentDialogProps) {
  const router = useRouter()
  const balanceDue = Number(totalAmount) - Number(paidAmount)

  const [amount, setAmount] = useState<string>(balanceDue.toFixed(2))
  const [paymentDate, setPaymentDate] = useState<string>(todayIso())
  const [paymentMethod, setPaymentMethod] = useState<string>('')
  const [referenceNumber, setReferenceNumber] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [settlementReason, setSettlementReason] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  const amountNum = Number(amount)
  const amountValid = amountNum > 0 && amountNum <= balanceDue
  const isBelowBalance = amountNum > 0 && amountNum < balanceDue
  const needsSettlementReason = mode === 'mark-paid' && isBelowBalance
  const settlementReasonValid = !needsSettlementReason || settlementReason.trim().length > 0
  const canSubmit = amountValid && settlementReasonValid && !submitting

  const title = mode === 'mark-paid' ? 'Mark Invoice as Paid' : 'Record Payment'
  const description =
    mode === 'mark-paid'
      ? 'Record a final payment and mark the invoice as settled.'
      : 'Record a partial payment without changing invoice status.'

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    const common = {
      amount: amountNum,
      paymentDate,
      paymentMethod: paymentMethod || undefined,
      referenceNumber: referenceNumber || undefined,
      notes: notes || undefined,
    }
    const result =
      mode === 'mark-paid'
        ? await markInvoicePaid(invoiceId, {
            ...common,
            settlementReason: settlementReason.trim() || undefined,
          })
        : await recordPayment(invoiceId, common)
    setSubmitting(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success(mode === 'mark-paid' ? 'Invoice marked as paid' : 'Payment recorded')
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="rounded-md bg-muted/50 p-3 text-sm flex items-center justify-between gap-4">
          <div>
            <div className="text-muted-foreground text-xs">Total</div>
            <div className="font-medium">{formatCurrency(totalAmount)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Already Paid</div>
            <div className="font-medium">{formatCurrency(paidAmount)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Balance Due</div>
            <div className="font-semibold">{formatCurrency(balanceDue)}</div>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="payment-amount">Amount</Label>
            <Input
              id="payment-amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {!amountValid && amount !== '' && (
              <p className="text-xs text-destructive">
                Amount must be between $0.01 and {formatCurrency(balanceDue)}.
              </p>
            )}
          </div>

          <div className="grid gap-1">
            <Label htmlFor="payment-date">Payment Date</Label>
            <Input
              id="payment-date"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>

          <div className="grid gap-1">
            <Label htmlFor="payment-method">Payment Method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger id="payment-method">
                <SelectValue placeholder="Select method (optional)" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="reference-number">Reference Number</Label>
            <Input
              id="reference-number"
              placeholder="Check #, transaction ID…"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
            />
          </div>

          <div className="grid gap-1">
            <Label htmlFor="payment-notes">Notes</Label>
            <Textarea
              id="payment-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {needsSettlementReason && (
            <div className="grid gap-1">
              <Label htmlFor="settlement-reason">
                Settlement Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="settlement-reason"
                rows={2}
                placeholder="e.g. PI settlement final — attorney lien accepted"
                value={settlementReason}
                onChange={(e) => setSettlementReason(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Required when accepting less than the balance due as final payment.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? 'Saving…' : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
