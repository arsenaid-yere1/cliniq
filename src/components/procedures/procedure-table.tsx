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
import { ArrowUpDown, FileText, Loader2, Pencil } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { RecordProcedureDialog, type ProcedureInitialData } from './record-procedure-dialog'
import { getProcedureById, type ProcedureDefaults } from '@/actions/procedures'
import { useCaseStatus } from '@/components/patients/case-status-context'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'

interface Procedure {
  id: string
  procedure_date: string
  procedure_name: string
  injection_site: string | null
  laterality: string | null
  site_count: number | null
  procedure_number: number | null
  // Story 4.2 fields
  blood_draw_volume_ml: number | null
  centrifuge_duration_min: number | null
  prep_protocol: string | null
  kit_lot_number: string | null
  anesthetic_agent: string | null
  anesthetic_dose_ml: number | null
  patient_tolerance: string | null
  injection_volume_ml: number | null
  needle_gauge: string | null
  guidance_method: string | null
  target_confirmed_imaging: boolean | null
  complications: string | null
  supplies_used: string | null
  compression_bandage: boolean | null
  activity_restriction_hrs: number | null
  diagnoses: unknown
  consent_obtained: boolean | null
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
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
    accessorKey: 'injection_site',
    header: 'Injection Site',
    cell: ({ row }) => {
      const site = row.original.injection_site
      const count = row.original.site_count ?? 1
      if (!site) return '—'
      return count > 1 ? `${site} ×${count}` : site
    },
  },
  {
    accessorKey: 'laterality',
    header: 'Laterality',
    cell: ({ getValue }) => {
      const val = getValue() as string | null
      if (!val) return '—'
      return val.charAt(0).toUpperCase() + val.slice(1)
    },
  },
  {
    accessorKey: 'procedure_number',
    header: '# in Series',
    cell: ({ getValue }) => {
      const val = getValue() as number | null
      return val != null ? ordinal(val) : '—'
    },
  },
]

interface ProcedureTableProps {
  procedures: Procedure[]
  caseId: string
  diagnosisSuggestions: Array<{ icd10_code: string | null; description: string }>
  noteStatuses?: Record<string, string>
  procedureDefaults?: ProcedureDefaults | null
  patientLastName: string | null
}

export function ProcedureTable({ procedures, caseId, diagnosisSuggestions, noteStatuses = {}, procedureDefaults, patientLastName }: ProcedureTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [editingProcedure, setEditingProcedure] = useState<ProcedureInitialData | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const caseStatus = useCaseStatus()
  const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)

  async function handleEditClick(id: string) {
    setLoadingId(id)
    const result = await getProcedureById(id)
    setLoadingId(null)
    if (result.data) setEditingProcedure(result.data as ProcedureInitialData)
  }

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
        {!isLocked && <RecordProcedureDialog caseId={caseId} diagnosisSuggestions={diagnosisSuggestions} procedureDefaults={procedureDefaults} patientLastName={patientLastName} />}
      </div>

      {editingProcedure && (
        <RecordProcedureDialog
          caseId={caseId}
          diagnosisSuggestions={diagnosisSuggestions}
          initialData={editingProcedure}
          patientLastName={patientLastName}
          open={true}
          onOpenChange={(open) => { if (!open) setEditingProcedure(null) }}
        />
      )}

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
                <TableHead />
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
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {noteStatuses[row.original.id] && (
                        <Badge
                          variant="outline"
                          className={
                            noteStatuses[row.original.id] === 'finalized'
                              ? 'border-green-600 bg-green-500/10 text-green-700 dark:text-green-400 text-xs'
                              : 'text-xs'
                          }
                        >
                          {noteStatuses[row.original.id] === 'finalized' ? 'Finalized' : 'Draft'}
                        </Badge>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                          >
                            <Link href={`/patients/${caseId}/procedures/${row.original.id}/note`}>
                              <FileText className="h-4 w-4" />
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Procedure Note</TooltipContent>
                      </Tooltip>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isLocked || loadingId === row.original.id}
                        onClick={() => handleEditClick(row.original.id)}
                      >
                        {loadingId === row.original.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Pencil className="h-4 w-4" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="h-24 text-center">
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
