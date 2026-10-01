'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
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
  discharge_visit_date: string | null
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
    // The default excludes archived; pick the Archived option explicitly to see them.
    const statusOk = statusFilter === 'all' ? c.case_status !== 'archived' : c.case_status === statusFilter
    const attorneyOk = attorneyFilter === 'all' || c.attorney_id === attorneyFilter
    return statusOk && attorneyOk
  })

  const hasFilters = globalFilter !== '' || statusFilter !== 'all' || attorneyFilter !== 'all'
  const archivedOnly = !hasFilters && cases.length > 0 && cases.every(c => c.case_status === 'archived')
  function clearFilters() {
    setGlobalFilter('')
    setStatusFilter('all')
    setAttorneyFilter('all')
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Patient Cases</h1>
        <Button asChild>
          <Link href="/patients/new">
            <Plus className="h-4 w-4 mr-2" />
            New Patient Case
          </Link>
        </Button>
      </div>

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="w-full min-w-0 space-y-2 sm:w-72 sm:flex-1">
          <Label htmlFor="case-search">Search cases</Label>
          <Input
            id="case-search"
            placeholder="Search by name or case number..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="w-full"
          />
        </div>
        <div className="w-full min-w-0 space-y-2 sm:w-60">
          <Label htmlFor="case-status-filter">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="case-status-filter" className="w-full min-w-0">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All non-archived statuses</SelectItem>
              {(Object.entries(CASE_STATUS_CONFIG) as [CaseStatus, typeof CASE_STATUS_CONFIG[CaseStatus]][]).map(
                ([key, config]) => (
                  <SelectItem key={key} value={key}>{config.label}</SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full min-w-0 space-y-2 sm:w-60">
          <Label htmlFor="case-attorney-filter">Attorney</Label>
          <Select value={attorneyFilter} onValueChange={setAttorneyFilter}>
            <SelectTrigger id="case-attorney-filter" className="w-full min-w-0">
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

        {hasFilters && <Button variant="outline" onClick={clearFilters}>Clear filters</Button>}
      </div>

      <PatientListTable
        cases={filteredCases}
        totalCaseCount={cases.length}
        onClearFilters={clearFilters}
        archivedOnly={archivedOnly}
        onViewArchived={() => setStatusFilter('archived')}
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
      />
    </div>
  )
}
