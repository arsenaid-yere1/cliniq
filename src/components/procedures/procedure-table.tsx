'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Procedure {
  id: string
  procedure_date: string
  procedure_name: string
  cpt_code: string | null
  charge_amount: number | null
  notes: string | null
  provider: { full_name: string } | null
}

const columns: ColumnDef<Procedure>[] = [
  {
    accessorKey: 'procedure_date',
    header: ({ column }) => (
      <Button variant="ghost" size="sm" onClick={() => column.toggleSorting()}>
        Date <ArrowUpDown className="ml-1 h-3 w-3" />
      </Button>
    ),
    cell: ({ getValue }) => format(new Date((getValue() as string) + 'T00:00:00'), 'MM/dd/yyyy'),
  },
  {
    accessorKey: 'procedure_name',
    header: 'Procedure',
  },
  {
    accessorKey: 'cpt_code',
    header: 'CPT Code',
    cell: ({ getValue }) => (getValue() as string) || '—',
  },
  {
    accessorFn: (row) => (Array.isArray(row.provider) ? row.provider[0]?.full_name : row.provider?.full_name) ?? null,
    id: 'provider',
    header: 'Provider',
    cell: ({ getValue }) => (getValue() as string) || '—',
  },
  {
    accessorKey: 'charge_amount',
    header: ({ column }) => (
      <Button variant="ghost" size="sm" onClick={() => column.toggleSorting()}>
        Amount <ArrowUpDown className="ml-1 h-3 w-3" />
      </Button>
    ),
    cell: ({ getValue }) => {
      const val = getValue() as number | null
      return val != null ? `$${Number(val).toFixed(2)}` : '—'
    },
  },
  {
    accessorKey: 'notes',
    header: 'Notes',
    cell: ({ getValue }) => {
      const val = getValue() as string | null
      if (!val) return '—'
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">{val.length > 50 ? val.slice(0, 50) + '...' : val}</span>
          </TooltipTrigger>
          {val.length > 50 && <TooltipContent className="max-w-xs">{val}</TooltipContent>}
        </Tooltip>
      )
    },
  },
]

export function ProcedureTable({ procedures }: { procedures: Procedure[] }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  const table = useReactTable({
    data: procedures,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Search procedures..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button disabled>Record Procedure</Button>
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
                  No procedures recorded.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
