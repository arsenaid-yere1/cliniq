'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface CaseData {
  id: string
  case_number: string
  case_status: string
  accident_date: string | null
  patient: {
    first_name: string
    last_name: string
    date_of_birth: string
  } | null
}

const statusColors: Record<string, string> = {
  intake: 'bg-blue-100 text-blue-800 border-blue-200',
  active: 'bg-green-100 text-green-800 border-green-200',
  pending_settlement: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  closed: 'bg-gray-100 text-gray-800 border-gray-200',
  archived: 'bg-gray-50 text-gray-500 border-gray-200',
}

const statusLabels: Record<string, string> = {
  intake: 'Intake',
  active: 'Active',
  pending_settlement: 'Pending Settlement',
  closed: 'Closed',
  archived: 'Archived',
}

const navItems = [
  { label: 'Overview', href: '', enabled: true },
  { label: 'Documents', href: '/documents', enabled: true },
  { label: 'Clinical Data', href: '/clinical', enabled: false },
  { label: 'Procedures', href: '/procedures', enabled: true },
  { label: 'Billing', href: '/billing', enabled: true },
  { label: 'Timeline', href: '/timeline', enabled: true },
]

export function CaseSidebar({ caseData }: { caseData: CaseData }) {
  const pathname = usePathname()
  const [copied, setCopied] = useState(false)
  const basePath = `/patients/${caseData.id}`

  async function handleCopy() {
    await navigator.clipboard.writeText(caseData.case_number)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <aside className="w-[280px] shrink-0 border-r bg-muted/30 p-6 space-y-4">
      {caseData.patient && (
        <h2 className="text-lg font-bold">
          {caseData.patient.first_name} {caseData.patient.last_name}
        </h2>
      )}

      <div className="flex items-center gap-2">
        <span className="font-mono text-sm">{caseData.case_number}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
          {copied ? (
            <Check className="h-3 w-3 text-green-600" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      </div>

      {caseData.patient && (
        <div className="text-sm text-muted-foreground">
          DOB: {format(new Date(caseData.patient.date_of_birth + 'T00:00:00'), 'MM/dd/yyyy')}
        </div>
      )}

      {caseData.accident_date && (
        <div className="text-sm text-muted-foreground">
          Accident: {format(new Date(caseData.accident_date + 'T00:00:00'), 'MM/dd/yyyy')}
        </div>
      )}

      <Badge className={statusColors[caseData.case_status] ?? ''}>
        {statusLabels[caseData.case_status] ?? caseData.case_status}
      </Badge>

      <Separator />

      <nav className="space-y-1">
        {navItems.map((item) => {
          const href = basePath + item.href
          const isActive = item.href === ''
            ? pathname === basePath
            : pathname.startsWith(href)

          if (!item.enabled) {
            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <span className="flex items-center rounded-md px-3 py-2 text-sm text-muted-foreground cursor-not-allowed">
                    {item.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Coming Soon</TooltipContent>
              </Tooltip>
            )
          }

          return (
            <Link
              key={item.label}
              href={href}
              className={`flex items-center rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent ${
                isActive ? 'bg-accent font-medium' : ''
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
