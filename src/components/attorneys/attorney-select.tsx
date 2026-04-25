'use client'

import { useEffect, useState, use } from 'react'
import { listAttorneys } from '@/actions/attorneys'
import { AttorneyForm } from './attorney-form'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus } from 'lucide-react'

interface Attorney {
  id: string
  first_name: string
  last_name: string
  firm_name: string | null
}

interface AttorneySelectProps {
  value: string
  onChange: (value: string) => void
  initialAttorneys?: Attorney[]
}

// Stable promise for initial load — created once per module, refreshed on each new mount
let initialLoadPromise: Promise<Attorney[]> | null = null

function getInitialAttorneys(): Promise<Attorney[]> {
  if (!initialLoadPromise) {
    initialLoadPromise = listAttorneys().then((r) => r.data ?? [])
  }
  return initialLoadPromise
}

export function AttorneySelect({ value, onChange, initialAttorneys }: AttorneySelectProps) {
  const loaded = initialAttorneys ?? use(getInitialAttorneys())
  const [attorneys, setAttorneys] = useState<Attorney[]>(loaded)
  const [showAddDialog, setShowAddDialog] = useState(false)

  useEffect(() => {
    if (initialAttorneys) return
    let cancelled = false
    listAttorneys().then((r) => {
      if (cancelled) return
      const fresh = r.data ?? []
      setAttorneys(fresh)
      initialLoadPromise = Promise.resolve(fresh)
    })
    return () => { cancelled = true }
  }, [initialAttorneys])

  function handleAttorneyCreated(attorney: { id: string; first_name: string; last_name: string; firm_name?: string | null }) {
    setAttorneys((prev) => [...prev, { ...attorney, firm_name: attorney.firm_name ?? null }])
    onChange(attorney.id)
    setShowAddDialog(false)
    initialLoadPromise = null
  }

  return (
    <div className="flex gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Select attorney" />
        </SelectTrigger>
        <SelectContent>
          {attorneys.map((attorney) => (
            <SelectItem key={attorney.id} value={attorney.id}>
              {attorney.last_name}, {attorney.first_name}
              {attorney.firm_name ? ` — ${attorney.firm_name}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" variant="outline" size="icon" onClick={() => setShowAddDialog(true)}>
        <Plus className="h-4 w-4" />
      </Button>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Attorney</DialogTitle>
          </DialogHeader>
          <AttorneyForm onSuccess={handleAttorneyCreated} embedded />
        </DialogContent>
      </Dialog>
    </div>
  )
}
