'use client'

import { useEffect, useState } from 'react'
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
  attorney_id: string | null
  patient: {
    id: string
    first_name: string
    last_name: string
  } | null
  attorney: {
    id: string
    first_name: string
    last_name: string
    firm_name: string | null
  } | null
}

function attorneyLabel(a: NonNullable<PatientCase['attorney']>) {
  const name = `${a.last_name}, ${a.first_name}`
  return a.firm_name ? `${name} — ${a.firm_name}` : name
}

// Persist filter selections across navigation (e.g. viewing a case and going back).
const FILTER_STORAGE_KEY = 'patient-cases-filters'

function loadFilters() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(FILTER_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as { search?: string; status?: string; attorney?: string }) : null
  } catch {
    return null
  }
}

export function PatientListPageClient({ cases }: { cases: PatientCase[] }) {
  const [globalFilter, setGlobalFilter] = useState(() => loadFilters()?.search ?? '')
  const [statusFilter, setStatusFilter] = useState<string>(() => loadFilters()?.status ?? 'all')
  const [attorneyFilter, setAttorneyFilter] = useState<string>(() => loadFilters()?.attorney ?? 'all')

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify({ search: globalFilter, status: statusFilter, attorney: attorneyFilter })
      )
    } catch {
      // sessionStorage unavailable (private mode / quota) — filters just won't persist.
    }
  }, [globalFilter, statusFilter, attorneyFilter])

  // Distinct attorneys present in the case list, sorted by label.
  const attorneys = Array.from(
    new Map(
      cases
        .map((c) => c.attorney)
        .filter((a): a is NonNullable<PatientCase['attorney']> => a !== null)
        .map((a) => [a.id, a] as const)
    ).values()
  ).sort((a, b) => attorneyLabel(a).localeCompare(attorneyLabel(b)))

  const filteredCases = cases.filter((c) => {
    // "All Statuses" excludes archived; pick the Archived option explicitly to see them.
    const statusOk = statusFilter === 'all' ? c.case_status !== 'archived' : c.case_status === statusFilter
    const attorneyOk = attorneyFilter === 'all' || c.attorney_id === attorneyFilter
    return statusOk && attorneyOk
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
              <SelectItem value="all">All Statuses</SelectItem>
              {(Object.entries(CASE_STATUS_CONFIG) as [CaseStatus, typeof CASE_STATUS_CONFIG[CaseStatus]][]).map(
                ([key, config]) => (
                  <SelectItem key={key} value={key}>{config.label}</SelectItem>
                )
              )}
            </SelectContent>
          </Select>
          <Select value={attorneyFilter} onValueChange={setAttorneyFilter}>
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="Filter by attorney" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Attorneys</SelectItem>
              {attorneys.map((a) => (
                <SelectItem key={a.id} value={a.id}>{attorneyLabel(a)}</SelectItem>
              ))}
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
