'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Patient Cases</h1>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Search by name or case number..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
        <Button asChild>
          <Link href="/patients/new">
            <Plus className="h-4 w-4 mr-2" />
            New Patient Case
          </Link>
        </Button>
      </div>

      <PatientListTable
        cases={cases}
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
      />
    </div>
  )
}
