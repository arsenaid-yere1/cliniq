import { DollarSign } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

interface BillingSummaryCardProps {
  summary: {
    total_billed: number
    total_paid: number
    balance_due: number
  }
}

function formatCurrency(value: number) {
  return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function BillingSummaryCard({ summary }: BillingSummaryCardProps) {
  return (
    <Card>
      <CardContent className="grid grid-cols-3 gap-6 p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-muted p-2">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Billed</p>
            <p className="text-xl font-bold">{formatCurrency(summary.total_billed)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-muted p-2">
            <DollarSign className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Paid</p>
            <p className="text-xl font-bold">{formatCurrency(summary.total_paid)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-muted p-2">
            <DollarSign className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Balance Due</p>
            <p className={`text-xl font-bold ${Number(summary.balance_due) > 0 ? 'text-red-600' : ''}`}>
              {formatCurrency(summary.balance_due)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
