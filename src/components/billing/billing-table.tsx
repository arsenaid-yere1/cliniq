'use client'

import { useState } from 'react'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  paid: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  partial: 'bg-blue-100 text-blue-800 border-blue-200',
  denied: 'bg-red-100 text-red-800 border-red-200',
  overdue: 'bg-red-100 text-red-800 border-red-200',
  draft: 'bg-gray-100 text-gray-800 border-gray-200',
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

export function BillingTable({ invoices }: { invoices: Invoice[] }) {
  const [sorting, setSorting] = useState<SortingState>([])

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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button disabled>Create Invoice</Button>
          </TooltipTrigger>
          <TooltipContent>Coming Soon</TooltipContent>
        </Tooltip>
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
                <TableRow key={row.id}>
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
