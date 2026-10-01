'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CASE_STATUS_CONFIG, type CaseStatus } from '@/lib/constants/case-status'
import { computeDocumentDueDate, DUE_STATUS_CONFIG } from '@/lib/cases/document-due-date'
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
  discharge_visit_date: string | null
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
  totalCaseCount, onClearFilters, archivedOnly = false, onViewArchived,
}: {
  cases: PatientCase[]
  totalCaseCount: number
  onClearFilters: () => void
  archivedOnly?: boolean
  onViewArchived?: () => void
  globalFilter: string
  onGlobalFilterChange: (value: string) => void
}) {
  const router = useRouter()

  const columns: ColumnDef<PatientCase>[] = [
    {
      accessorKey: 'case_number',
      header: 'Case Number',
      cell: ({ getValue, row }) => (
        <Link href={`/patients/${row.original.id}`} className="font-mono text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm">{getValue() as string}</Link>
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
    {
      id: 'due_date',
      header: 'Due Date',
      cell: ({ row }) => {
        // Due labels only apply to active cases; other statuses (intake, pending_*,
        // closed, archived) don't carry a document-to-lawyer deadline.
        if (row.original.case_status !== 'active') {
          return <span className="text-muted-foreground">—</span>
        }
        const due = computeDocumentDueDate(row.original.discharge_visit_date)
        if (!due) return <span className="text-muted-foreground">—</span>
        const config = DUE_STATUS_CONFIG[due.status]
        return (
          <div className="flex items-center gap-2">
            <span>{format(due.dueDate, 'MM/dd/yyyy')}</span>
            <Badge variant="outline" className={config.color}>{config.label}</Badge>
          </div>
        )
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
    <div className="min-w-0 rounded-md border">
      {table.getRowModel().rows.length === 0 ? (
        <div className="p-6 text-center">
          {totalCaseCount === 0 ? 'No patient cases found. Create your first case.' : archivedOnly ? (
            <div className="space-y-2 whitespace-normal">
              <p>No non-archived cases.</p>
              <Button variant="outline" onClick={onViewArchived}>View archived</Button>
            </div>
          ) : (
            <div className="space-y-2 whitespace-normal">
              <p>No cases match your filters.</p>
              <Button variant="outline" onClick={onClearFilters}>Clear filters</Button>
            </div>
          )}
        </div>
      ) : <Table>
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
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              className="cursor-pointer"
              onClick={(event) => {
                if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
                  || window.getSelection()?.toString()
                  || (event.target instanceof Element && event.target.closest('a, button, input, select, textarea, [role="button"], [role="link"]'))) return
                router.push(`/patients/${row.original.id}`)
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
  )
}
