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
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface PatientRow {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string
  phone_primary: string | null
  case_count: number
  active_case_count: number
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
        <span className="font-medium">
          {row.original.last_name}, {row.original.first_name}
        </span>
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Patients</h1>
        <Button asChild>
          <Link href="/patients/new">
            <Plus className="h-4 w-4 mr-2" />
            New Patient Case
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by name or phone..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="rounded-md border">
        <Table>
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
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/people/${row.original.id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No patients yet. Create one to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
