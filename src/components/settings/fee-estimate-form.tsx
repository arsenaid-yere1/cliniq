'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2, Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  createFeeEstimateItem,
  updateFeeEstimateItem,
  deleteFeeEstimateItem,
} from '@/actions/fee-estimate'

interface FeeEstimateConfigItem {
  id: string
  description: string
  fee_category: string
  price_min: number
  price_max: number
  sort_order: number
}

interface LocalItem {
  localId: string
  id?: string
  description: string
  fee_category: string
  price_min: number
  price_max: number
  sort_order: number
}

interface FeeEstimateFormProps {
  initialData: FeeEstimateConfigItem[]
}

function toLocalItems(items: FeeEstimateConfigItem[]): LocalItem[] {
  return items.map((item) => ({
    localId: item.id,
    id: item.id,
    description: item.description,
    fee_category: item.fee_category,
    price_min: item.price_min,
    price_max: item.price_max,
    sort_order: item.sort_order,
  }))
}

export function FeeEstimateForm({ initialData }: FeeEstimateFormProps) {
  const [items, setItems] = useState<LocalItem[]>(() => toLocalItems(initialData))
  const [saving, setSaving] = useState(false)

  function handleChange(
    localId: string,
    field: keyof Pick<LocalItem, 'description' | 'price_min' | 'price_max'>,
    value: string,
  ) {
    setItems((prev) =>
      prev.map((item) =>
        item.localId === localId ? { ...item, [field]: value } : item
      )
    )
  }

  function handleCategoryChange(localId: string, value: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.localId === localId ? { ...item, fee_category: value } : item
      )
    )
  }

  function addRow() {
    const newLocalId = `new-${Date.now()}`
    setItems((prev) => [
      ...prev,
      {
        localId: newLocalId,
        description: '',
        fee_category: 'professional',
        price_min: 0,
        price_max: 0,
        sort_order: (prev.length > 0 ? Math.max(...prev.map((i) => i.sort_order)) : 0) + 1,
      },
    ])
  }

  function removeNewRow(localId: string) {
    setItems((prev) => prev.filter((item) => item.localId !== localId))
  }

  async function handleDeleteExisting(id: string, localId: string) {
    const result = await deleteFeeEstimateItem(id)
    if (result.error) {
      toast.error(result.error)
      return
    }
    setItems((prev) => prev.filter((item) => item.localId !== localId))
    toast.success('Fee estimate item removed')
  }

  function isDirty(item: LocalItem): boolean {
    if (!item.id) return true
    const original = initialData.find((d) => d.id === item.id)
    if (!original) return true
    return (
      item.description !== original.description ||
      item.fee_category !== original.fee_category ||
      Number(item.price_min) !== Number(original.price_min) ||
      Number(item.price_max) !== Number(original.price_max)
    )
  }

  const hasDirtyItems = items.some(isDirty)

  async function handleSave() {
    for (const item of items) {
      if (!item.description.trim()) {
        toast.error('All items must have a description')
        return
      }
      if (Number(item.price_min) < 0 || Number(item.price_max) < 0) {
        toast.error('Prices must be non-negative')
        return
      }
      if (Number(item.price_max) < Number(item.price_min)) {
        toast.error('Max price must be greater than or equal to min price')
        return
      }
    }

    setSaving(true)
    try {
      const dirtyItems = items.filter(isDirty)
      const results = await Promise.all(
        dirtyItems.map((item) => {
          const values = {
            description: item.description,
            fee_category: item.fee_category as 'professional' | 'practice_center',
            price_min: Number(item.price_min),
            price_max: Number(item.price_max),
          }
          if (item.id) {
            return updateFeeEstimateItem(item.id, values)
          }
          return createFeeEstimateItem(values)
        })
      )

      const errors = results.filter((r) => r.error)
      if (errors.length > 0) {
        toast.error('Some items failed to save')
        return
      }

      toast.success('Fee estimates saved')

      setItems((prev) =>
        prev.map((item) => {
          if (!item.id) {
            const idx = dirtyItems.indexOf(item)
            const result = results[idx]
            if (result && 'data' in result && result.data) {
              const savedData = result.data as FeeEstimateConfigItem
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
          No fee estimate items configured. Add your first item to get started.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="w-[180px]">Category</TableHead>
              <TableHead className="w-[140px]">Min Price ($)</TableHead>
              <TableHead className="w-[140px]">Max Price ($)</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.localId}>
                <TableCell>
                  <Input
                    value={item.description}
                    onChange={(e) => handleChange(item.localId, 'description', e.target.value)}
                    placeholder="e.g. Initial Consultation"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={item.fee_category}
                    onValueChange={(value) => handleCategoryChange(item.localId, value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="professional">Professional</SelectItem>
                      <SelectItem value="practice_center">Practice Center</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.price_min}
                    onChange={(e) => handleChange(item.localId, 'price_min', e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.price_max}
                    onChange={(e) => handleChange(item.localId, 'price_max', e.target.value)}
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
                          <AlertDialogTitle>Remove fee estimate item?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove &quot;{item.description}&quot; from the fee estimate configuration.
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
          Add Item
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
