'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowUpDown, Download, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { deleteInvoice, generateInvoicePdf } from '@/actions/billing'
import { buildDownloadFilename } from '@/lib/filenames/build-download-filename'
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

interface BillingTableProps {
  invoices: Invoice[]
  caseId?: string
  patientLastName?: string | null
  onCreateClick?: () => void
}

export function BillingTable({ invoices, caseId, patientLastName, onCreateClick }: BillingTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Invoice | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const router = useRouter()

  async function handleDownload(invoice: Invoice) {
    setDownloadingId(invoice.id)
    try {
      const result = await generateInvoicePdf(invoice.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      const bytes = Uint8Array.from(atob(result.data!), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = buildDownloadFilename({
        lastName: patientLastName,
        docType: invoice.invoice_type === 'facility' ? 'MedicalFacilityInvoice' : 'MedicalInvoice',
        date: invoice.invoice_date,
      })
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloadingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget || !caseId) return
    setIsDeleting(true)
    const result = await deleteInvoice(deleteTarget.id, caseId)
    setIsDeleting(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Invoice deleted')
      router.refresh()
    }
    setDeleteTarget(null)
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
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const invoice = row.original
        const isDraft = invoice.status === 'draft'
        const isDownloading = downloadingId === invoice.id
        return (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              disabled={isDownloading}
              onClick={() => handleDownload(invoice)}
              aria-label="Download invoice PDF"
            >
              <Download className="h-4 w-4" />
            </Button>
            {caseId && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive disabled:opacity-40"
                disabled={!isDraft}
                title={isDraft ? 'Delete draft invoice' : 'Only draft invoices can be deleted. Void instead.'}
                onClick={() => setDeleteTarget(invoice)}
                aria-label="Delete invoice"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      },
    },
  ]

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

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Invoice</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this draft invoice? This action can be undone by an administrator.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
