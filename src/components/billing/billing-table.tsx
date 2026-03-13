'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowUpDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Invoice {
  id: string
  invoice_date: string
  invoice_number: string
  total_amount: number
  paid_amount: number
  status: string
}

const invoiceStatusColors: Record<string, string> = {
  paid: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
  pending: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',
  partial: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
  denied: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
  overdue: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
  draft: 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
}

const invoiceStatusLabels: Record<string, string> = {
  paid: 'Paid',
  pending: 'Pending',
  partial: 'Partial',
  denied: 'Denied',
  overdue: 'Overdue',
  draft: 'Draft',
}

const columns: ColumnDef<Invoice>[] = [
  {
    accessorKey: 'invoice_date',
    header: ({ column }) => (
      <Button variant="ghost" size="sm" onClick={() => column.toggleSorting()}>
        Date <ArrowUpDown className="ml-1 h-3 w-3" />
      </Button>
    ),
    cell: ({ getValue }) => format(new Date((getValue() as string) + 'T00:00:00'), 'MM/dd/yyyy'),
  },
  {
    accessorKey: 'invoice_number',
    header: 'Invoice #',
    cell: ({ getValue }) => <span className="font-mono">{getValue() as string}</span>,
  },
  {
    accessorKey: 'total_amount',
    header: ({ column }) => (
      <Button variant="ghost" size="sm" onClick={() => column.toggleSorting()}>
        Amount <ArrowUpDown className="ml-1 h-3 w-3" />
      </Button>
    ),
    cell: ({ getValue }) => `$${Number(getValue()).toFixed(2)}`,
  },
  {
    accessorKey: 'paid_amount',
    header: 'Paid',
    cell: ({ getValue }) => `$${Number(getValue()).toFixed(2)}`,
  },
  {
    id: 'balance',
    header: 'Balance',
    accessorFn: (row) => Number(row.total_amount) - Number(row.paid_amount),
    cell: ({ getValue }) => {
      const val = getValue() as number
      return (
        <span className={val > 0 ? 'text-red-600 font-medium' : ''}>
          ${val.toFixed(2)}
        </span>
      )
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => {
      const status = getValue() as string
      return (
        <Badge variant="outline" className={invoiceStatusColors[status] ?? ''}>
          {invoiceStatusLabels[status] ?? status}
        </Badge>
      )
    },
  },
]

interface BillingTableProps {
  invoices: Invoice[]
  caseId?: string
  onCreateClick?: () => void
}

export function BillingTable({ invoices, caseId, onCreateClick }: BillingTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const router = useRouter()

  const table = useReactTable({
    data: invoices,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button onClick={onCreateClick}>Create Invoice</Button>
      </div>

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
                  className={caseId ? 'cursor-pointer' : ''}
                  onClick={() => {
                    if (caseId) {
                      router.push(`/patients/${caseId}/billing/${row.original.id}`)
                    }
                  }}
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
                  No billing history.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
