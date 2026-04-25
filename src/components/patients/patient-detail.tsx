'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { FilePlus, Pencil, Trash2, Loader2 } from 'lucide-react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CASE_STATUS_CONFIG, type CaseStatus } from '@/lib/constants/case-status'
import { deletePatient } from '@/actions/patients'
import { PatientEditDialog } from './patient-edit-dialog'

interface Patient {
  id: string
  first_name: string
  last_name: string
  middle_name: string | null
  date_of_birth: string
  gender: string | null
  phone_primary: string | null
  email: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip_code: string | null
}

interface CaseRow {
  id: string
  case_number: string
  case_status: string
  accident_date: string | null
  accident_type: string | null
  total_billed: number | string
  total_paid: number | string
  balance_due: number | string
  created_at: string
}

const accidentTypeLabels: Record<string, string> = {
  auto: 'Auto',
  slip_and_fall: 'Slip & Fall',
  workplace: 'Workplace',
  other: 'Other',
}

const genderLabels: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
}

export function PatientDetail({ patient, cases }: { patient: Patient; cases: CaseRow[] }) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const canDelete = cases.length === 0

  async function handleDelete() {
    setDeleting(true)
    const result = await deletePatient(patient.id)
    setDeleting(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Patient deleted')
    router.push('/people')
  }

  const columns: ColumnDef<CaseRow>[] = [
    {
      accessorKey: 'case_number',
      header: 'Case Number',
      cell: ({ getValue }) => <span className="font-mono text-sm">{getValue() as string}</span>,
    },
    {
      accessorKey: 'case_status',
      header: 'Status',
      cell: ({ getValue }) => {
        const s = getValue() as string
        const cfg = CASE_STATUS_CONFIG[s as CaseStatus]
        return (
          <Badge variant={cfg?.variant ?? 'secondary'} className={cfg?.color ?? ''}>
            {cfg?.label ?? s}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'accident_date',
      header: 'Accident',
      cell: ({ row }) => {
        const d = row.original.accident_date
        const t = row.original.accident_type
        return d
          ? `${format(new Date(d + 'T00:00:00'), 'MM/dd/yyyy')}${t ? ` · ${accidentTypeLabels[t] ?? t}` : ''}`
          : '—'
      },
    },
    {
      accessorKey: 'balance_due',
      header: 'Balance',
      cell: ({ getValue }) => {
        const v = Number(getValue() ?? 0)
        return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      },
    },
    {
      accessorKey: 'created_at',
      header: 'Opened',
      cell: ({ getValue }) => format(new Date(getValue() as string), 'MM/dd/yyyy'),
    },
  ]

  const table = useReactTable({
    data: cases,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const address = [patient.address_line1, patient.address_line2, patient.city, patient.state, patient.zip_code]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {patient.first_name} {patient.middle_name ? `${patient.middle_name} ` : ''}{patient.last_name}
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button
            variant="outline"
            onClick={() => setDeleteOpen(true)}
            disabled={!canDelete}
            title={canDelete ? undefined : 'Cannot delete: patient has cases'}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
          <Button asChild>
            <Link href={`/patients/new?patientId=${patient.id}`}>
              <FilePlus className="h-4 w-4 mr-2" />
              New Case for This Patient
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Patient Demographics</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Date of Birth</dt>
              <dd>{format(new Date(patient.date_of_birth + 'T00:00:00'), 'MM/dd/yyyy')}</dd>
            </div>
            {patient.gender && (
              <div>
                <dt className="text-muted-foreground">Gender</dt>
                <dd>{genderLabels[patient.gender] ?? patient.gender}</dd>
              </div>
            )}
            {patient.phone_primary && (
              <div>
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{patient.phone_primary}</dd>
              </div>
            )}
            {patient.email && (
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd>{patient.email}</dd>
              </div>
            )}
            {address && (
              <div className="col-span-2">
                <dt className="text-muted-foreground">Address</dt>
                <dd>{address}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cases ({cases.length})</CardTitle>
        </CardHeader>
        <CardContent>
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
                      No cases yet for this patient.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <PatientEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        patientId={patient.id}
        patient={patient}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete patient?</AlertDialogTitle>
            <AlertDialogDescription>
              This will soft-delete {patient.first_name} {patient.last_name}. Only allowed
              because no cases are attached. This action can be reversed by a database admin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
