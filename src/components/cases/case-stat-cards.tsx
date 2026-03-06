import { format } from 'date-fns'
import { FileText, Activity, DollarSign, Calendar } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { CaseDashboardStats } from '@/actions/dashboard'

const stats = [
  {
    key: 'documents' as const,
    label: 'Documents',
    icon: FileText,
    getValue: (s: CaseDashboardStats) => String(s.documentCount),
  },
  {
    key: 'procedures' as const,
    label: 'Procedures',
    icon: Activity,
    getValue: (s: CaseDashboardStats) => String(s.procedureCount),
  },
  {
    key: 'billed' as const,
    label: 'Total Billed',
    icon: DollarSign,
    getValue: (s: CaseDashboardStats) =>
      `$${s.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  },
  {
    key: 'lastVisit' as const,
    label: 'Last Procedure',
    icon: Calendar,
    getValue: (s: CaseDashboardStats) =>
      s.lastProcedureDate
        ? format(new Date(s.lastProcedureDate + 'T00:00:00'), 'MM/dd/yyyy')
        : 'None',
  },
]

export function CaseStatCards({ stats: data }: { stats: CaseDashboardStats }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon
        return (
          <Card key={stat.key}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-muted p-2">
                <Icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-xl font-bold">{stat.getValue(data)}</p>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
