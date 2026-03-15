'use client'

import { useRouter } from 'next/navigation'
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { CASE_STATUS_CONFIG, type CaseStatus } from '@/lib/constants/case-status'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { format } from 'date-fns'

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


export function PatientListTable({
  cases,
  globalFilter,
  onGlobalFilterChange,
}: {
  cases: PatientCase[]
  globalFilter: string
  onGlobalFilterChange: (value: string) => void
}) {
  const router = useRouter()

  const columns: ColumnDef<PatientCase>[] = [
    {
      accessorKey: 'case_number',
      header: 'Case Number',
      cell: ({ getValue }) => (
        <span className="font-mono text-sm">{getValue() as string}</span>
      ),
    },
    {
      id: 'patient_name',
      accessorFn: (row) =>
        row.patient ? `${row.patient.last_name}, ${row.patient.first_name}` : '—',
      header: 'Patient Name',
    },
    {
      accessorKey: 'case_status',
      header: 'Status',
      cell: ({ getValue }) => {
        const status = getValue() as string
        const config = CASE_STATUS_CONFIG[status as CaseStatus]
        return (
          <Badge
            variant={config?.variant ?? 'secondary'}
            className={config?.color ?? ''}
          >
            {config?.label ?? status}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'accident_date',
      header: 'Accident Date',
      cell: ({ getValue }) => {
        const date = getValue() as string | null
        return date ? format(new Date(date + 'T00:00:00'), 'MM/dd/yyyy') : '—'
      },
    },
    {
      accessorKey: 'created_at',
      header: 'Created',
      cell: ({ getValue }) => {
        const date = getValue() as string
        return format(new Date(date), 'MM/dd/yyyy')
      },
    },
  ]

  const table = useReactTable({
    data: cases,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { globalFilter },
    onGlobalFilterChange,
  })

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
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
                onClick={() => router.push(`/patients/${row.original.id}`)}
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
                No patient cases found. Create your first case.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
