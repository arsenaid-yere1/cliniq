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
import { INVOICE_STATUS_COLORS, INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/lib/constants/invoice-status'
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
  invoice_type: 'visit' | 'facility'
  total_amount: number
  paid_amount: number
  status: string
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
    accessorKey: 'invoice_type',
    header: 'Type',
    cell: ({ getValue }) => {
      const type = getValue() as 'visit' | 'facility'
      return type === 'facility' ? 'Medical Facility Invoice' : 'Medical Invoice'
    },
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
        <Badge variant="outline" className={INVOICE_STATUS_COLORS[status as InvoiceStatus] ?? ''}>
          {INVOICE_STATUS_LABELS[status as InvoiceStatus] ?? status}
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
