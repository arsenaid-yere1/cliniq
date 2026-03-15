'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CASE_STATUS_CONFIG, type CaseStatus } from '@/lib/constants/case-status'
import { PatientListTable } from './patient-list-table'

interface PatientCase {
  id: string
  case_number: string
  case_status: string
  accident_date: string | null
  created_at: string
  patient: {
    id: string
    first_name: string
    last_name: string
  } | null
}

export function PatientListPageClient({ cases }: { cases: PatientCase[] }) {
  const [globalFilter, setGlobalFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all_active')

  const filteredCases = cases.filter((c) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'all_active') return c.case_status !== 'archived'
    return c.case_status === statusFilter
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Patient Cases</h1>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search by name or case number..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="max-w-sm"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_active">All Active</SelectItem>
              <SelectItem value="all">All Statuses</SelectItem>
              {(Object.entries(CASE_STATUS_CONFIG) as [CaseStatus, typeof CASE_STATUS_CONFIG[CaseStatus]][]).map(
                ([key, config]) => (
                  <SelectItem key={key} value={key}>{config.label}</SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
        <Button asChild>
          <Link href="/patients/new">
            <Plus className="h-4 w-4 mr-2" />
            New Patient Case
          </Link>
        </Button>
      </div>

      <PatientListTable
        cases={filteredCases}
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
      />
    </div>
  )
}
