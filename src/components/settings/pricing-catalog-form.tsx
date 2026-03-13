'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2, Plus, Loader2 } from 'lucide-react'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  createServiceCatalogItem,
  updateServiceCatalogItem,
  deleteServiceCatalogItem,
} from '@/actions/service-catalog'

interface ServiceCatalogItem {
  id: string
  cpt_code: string
  description: string
  default_price: number
  sort_order: number
}

interface LocalItem {
  localId: string
  id?: string
  cpt_code: string
  description: string
  default_price: number
  sort_order: number
}

interface PricingCatalogFormProps {
  initialData: ServiceCatalogItem[]
}

function toLocalItems(items: ServiceCatalogItem[]): LocalItem[] {
  return items.map((item) => ({
    localId: item.id,
    id: item.id,
    cpt_code: item.cpt_code,
    description: item.description,
    default_price: item.default_price,
    sort_order: item.sort_order,
  }))
}

export function PricingCatalogForm({ initialData }: PricingCatalogFormProps) {
  const [items, setItems] = useState<LocalItem[]>(() => toLocalItems(initialData))
  const [saving, setSaving] = useState(false)

  function handleChange(localId: string, field: keyof Pick<LocalItem, 'cpt_code' | 'description' | 'default_price'>, value: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.localId === localId
          ? { ...item, [field]: field === 'default_price' ? value : value }
          : item
      )
    )
  }

  function addRow() {
    const newLocalId = `new-${Date.now()}`
    setItems((prev) => [
      ...prev,
      {
        localId: newLocalId,
        cpt_code: '',
        description: '',
        default_price: 0,
        sort_order: (prev.length > 0 ? Math.max(...prev.map((i) => i.sort_order)) : 0) + 1,
      },
    ])
  }

  function removeNewRow(localId: string) {
    setItems((prev) => prev.filter((item) => item.localId !== localId))
  }

  async function handleDeleteExisting(id: string, localId: string) {
    const result = await deleteServiceCatalogItem(id)
    if (result.error) {
      toast.error(result.error)
      return
    }
    setItems((prev) => prev.filter((item) => item.localId !== localId))
    toast.success('Service removed')
  }

  function isDirty(item: LocalItem): boolean {
    if (!item.id) return true // new row
    const original = initialData.find((d) => d.id === item.id)
    if (!original) return true
    return (
      item.cpt_code !== original.cpt_code ||
      item.description !== original.description ||
      Number(item.default_price) !== Number(original.default_price)
    )
  }

  const hasDirtyItems = items.some(isDirty)

  async function handleSave() {
    // Validate all items
    for (const item of items) {
      if (!item.cpt_code.trim()) {
        toast.error('All items must have a CPT code')
        return
      }
      if (!item.description.trim()) {
        toast.error('All items must have a description')
        return
      }
      if (Number(item.default_price) < 0) {
        toast.error('Prices must be non-negative')
        return
      }
    }

    setSaving(true)
    try {
      const dirtyItems = items.filter(isDirty)
      const results = await Promise.all(
        dirtyItems.map((item) => {
          const values = {
            cpt_code: item.cpt_code,
            description: item.description,
            default_price: Number(item.default_price),
          }
          if (item.id) {
            return updateServiceCatalogItem(item.id, values)
          }
          return createServiceCatalogItem(values)
        })
      )

      const errors = results.filter((r) => r.error)
      if (errors.length > 0) {
        toast.error('Some items failed to save')
        return
      }

      toast.success('Pricing catalog saved')

      // Update local state to reflect saved items (assign IDs to new items)
      setItems((prev) =>
        prev.map((item) => {
          if (!item.id) {
            const idx = dirtyItems.indexOf(item)
            const result = results[idx]
            if (result && 'data' in result && result.data) {
              const savedData = result.data as ServiceCatalogItem
              return {
                ...item,
                id: savedData.id,
                localId: savedData.id,
                sort_order: savedData.sort_order,
              }
            }
          }
          return item
        })
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm py-8 text-center">
          No services configured. Add your first service to get started.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">CPT Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[160px]">Default Price ($)</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.localId}>
                <TableCell>
                  <Input
                    value={item.cpt_code}
                    onChange={(e) => handleChange(item.localId, 'cpt_code', e.target.value)}
                    placeholder="e.g. 99204"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={item.description}
                    onChange={(e) => handleChange(item.localId, 'description', e.target.value)}
                    placeholder="Service description"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.default_price}
                    onChange={(e) => handleChange(item.localId, 'default_price', e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  {item.id ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove service?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove &quot;{item.description}&quot; from the pricing catalog.
                            Existing invoices will not be affected.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDeleteExisting(item.id!, item.localId)}>
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <Button variant="ghost" size="icon" onClick={() => removeNewRow(item.localId)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={addRow}>
          <Plus className="h-4 w-4 mr-1" />
          Add Service
        </Button>
        <Button onClick={handleSave} disabled={!hasDirtyItems || saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Changes'
          )}
        </Button>
      </div>
    </div>
  )
}
