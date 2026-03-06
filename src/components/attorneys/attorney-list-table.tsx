'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import { deleteAttorney } from '@/actions/attorneys'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { Pencil, Trash2, Plus } from 'lucide-react'

interface Attorney {
  id: string
  first_name: string
  last_name: string
  firm_name: string | null
  phone: string | null
  email: string | null
}

export function AttorneyListTable({ attorneys }: { attorneys: Attorney[] }) {
  const router = useRouter()
  const [globalFilter, setGlobalFilter] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const columns: ColumnDef<Attorney>[] = [
    {
      accessorFn: (row) => `${row.last_name}, ${row.first_name}`,
      id: 'name',
      header: 'Name',
    },
    {
      accessorKey: 'firm_name',
      header: 'Firm',
      cell: ({ getValue }) => getValue() || '—',
    },
    {
      accessorKey: 'phone',
      header: 'Phone',
      cell: ({ getValue }) => getValue() || '—',
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ getValue }) => getValue() || '—',
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/attorneys/${row.original.id}/edit`}>
              <Pencil className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteId(row.original.id)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  const table = useReactTable({
    data: attorneys,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
  })

  async function handleDelete() {
    if (!deleteId) return
    const result = await deleteAttorney(deleteId)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Attorney deleted')
      router.refresh()
    }
    setDeleteId(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Search by name or firm..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
        <Button asChild>
          <Link href="/attorneys/new">
            <Plus className="h-4 w-4 mr-2" />
            New Attorney
          </Link>
        </Button>
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
                  No attorneys found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Attorney</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this attorney? This action can be undone by an administrator.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
