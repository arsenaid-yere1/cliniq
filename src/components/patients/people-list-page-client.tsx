'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { format } from 'date-fns'
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { CASE_STATUS_CONFIG } from '@/lib/constants/case-status'

interface PatientRow {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string
  phone_primary: string | null
  case_count: number
  active_case_count: number
  pending_imaging_case_count: number
  balance_total: number
  last_activity: string | null
  last_accident_date: string | null
}

export function PeopleListPageClient({ patients }: { patients: PatientRow[] }) {
  const router = useRouter()
  const [globalFilter, setGlobalFilter] = useState('')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'last_name', desc: false }])

  const columns = useMemo<ColumnDef<PatientRow>[]>(() => [
    {
      id: 'last_name',
      accessorFn: (row) => `${row.last_name}, ${row.first_name}`,
      header: 'Name',
      cell: ({ row }) => (
        <Link href={`/people/${row.original.id}`} className="font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm">
          {row.original.last_name}, {row.original.first_name}
        </Link>
      ),
    },
    {
      accessorKey: 'date_of_birth',
      header: 'DOB',
      cell: ({ getValue }) => format(new Date((getValue() as string) + 'T00:00:00'), 'MM/dd/yyyy'),
    },
    {
      accessorKey: 'phone_primary',
      header: 'Phone',
      cell: ({ getValue }) => (getValue() as string | null) ?? '—',
    },
    {
      accessorKey: 'active_case_count',
      header: 'Active Cases',
      cell: ({ row }) => (
        <Badge variant={row.original.active_case_count > 0 ? 'default' : 'secondary'}>
          {row.original.active_case_count} / {row.original.case_count}
        </Badge>
      ),
    },
    {
      accessorKey: 'pending_imaging_case_count',
      header: 'Pending Imaging',
      cell: ({ row }) =>
        row.original.pending_imaging_case_count > 0 ? (
          <Badge variant="secondary" className={CASE_STATUS_CONFIG.pending_imaging.color}>
            {row.original.pending_imaging_case_count}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: 'balance_total',
      header: 'Balance',
      cell: ({ getValue }) => {
        const v = Number(getValue() ?? 0)
        return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      },
    },
    {
      accessorKey: 'last_accident_date',
      header: 'Last Accident',
      cell: ({ getValue }) => {
        const v = getValue() as string | null
        return v ? format(new Date(v + 'T00:00:00'), 'MM/dd/yyyy') : '—'
      },
    },
  ], [])

  const table = useReactTable({
    data: patients,
    columns,
    state: { globalFilter, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = String(filterValue).toLowerCase()
      const name = `${row.original.first_name} ${row.original.last_name}`.toLowerCase()
      const phone = (row.original.phone_primary ?? '').toLowerCase()
      return name.includes(q) || phone.includes(q)
    },
  })

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Patients</h1>
        <Button asChild>
          <Link href="/patients/new">
            <Plus className="h-4 w-4 mr-2" />
            New Patient Case
          </Link>
        </Button>
      </div>

      <div className="w-full max-w-sm space-y-2">
        <Label htmlFor="people-search">Search patients</Label>
        <Input
          id="people-search"
          placeholder="Search by name or phone..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="min-w-0 rounded-md border">
        {table.getRowModel().rows.length === 0 ? (
          <div className="p-6 text-center">
            {patients.length === 0 ? 'No patients yet. Create one to get started.' : (
              <div className="space-y-2 whitespace-normal">
                <p>No patients match your search.</p>
                <Button variant="outline" onClick={() => setGlobalFilter('')}>Clear search</Button>
              </div>
            )}
          </div>
        ) : <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={(event) => {
                  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
                    || window.getSelection()?.toString()
                    || (event.target instanceof Element && event.target.closest('a, button, input, select, textarea, [role="button"], [role="link"]'))) return
                  router.push(`/people/${row.original.id}`)
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>}
      </div>
    </div>
  )
}
