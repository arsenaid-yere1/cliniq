'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { deleteProviderProfile } from '@/actions/settings'
import { ProviderFormDialog } from './provider-form-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface ProviderProfile {
  id: string
  user_id: string | null
  display_name: string
  credentials: string | null
  license_number: string | null
  npi_number: string | null
  supervising_provider_id: string | null
  signature_storage_path?: string | null
}

interface ProviderListProps {
  providers: ProviderProfile[]
}

export function ProviderList({ providers: initialProviders }: ProviderListProps) {
  const router = useRouter()
  const [showFormDialog, setShowFormDialog] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderProfile | null>(null)
  const [deletingProvider, setDeletingProvider] = useState<ProviderProfile | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  function getSupervising(id: string | null) {
    if (!id) return '—'
    const sup = initialProviders.find((p) => p.id === id)
    if (!sup) return '—'
    return sup.display_name + (sup.credentials ? `, ${sup.credentials}` : '')
  }

  function handleAdd() {
    setEditingProvider(null)
    setShowFormDialog(true)
  }

  function handleEdit(provider: ProviderProfile) {
    setEditingProvider(provider)
    setShowFormDialog(true)
  }

  async function handleConfirmDelete() {
    if (!deletingProvider) return
    setIsDeleting(true)
    const result = await deleteProviderProfile(deletingProvider.id)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Provider deleted')
      router.refresh()
    }
    setIsDeleting(false)
    setDeletingProvider(null)
  }

  function handleFormSuccess() {
    setShowFormDialog(false)
    setEditingProvider(null)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Provider Profiles</CardTitle>
        <Button onClick={handleAdd} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add Provider
        </Button>
      </CardHeader>
      <CardContent>
        {initialProviders.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No providers yet. Click &quot;Add Provider&quot; to create one.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Display Name</TableHead>
                <TableHead>Credentials</TableHead>
                <TableHead>License #</TableHead>
                <TableHead>NPI</TableHead>
                <TableHead>Supervising Provider</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialProviders.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell className="font-medium">{provider.display_name}</TableCell>
                  <TableCell>{provider.credentials || '—'}</TableCell>
                  <TableCell>{provider.license_number || '—'}</TableCell>
                  <TableCell>{provider.npi_number || '—'}</TableCell>
                  <TableCell>{getSupervising(provider.supervising_provider_id)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(provider)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingProvider(provider)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ProviderFormDialog
        open={showFormDialog}
        onOpenChange={setShowFormDialog}
        provider={editingProvider}
        allProviders={initialProviders}
        onSuccess={handleFormSuccess}
      />

      <AlertDialog open={!!deletingProvider} onOpenChange={(open) => !open && setDeletingProvider(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Provider</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deletingProvider?.display_name}? This action can be undone by an administrator.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
