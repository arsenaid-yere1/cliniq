'use client'

import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { BOTOX_MUSCLE_OPTIONS } from '@/lib/procedures/enum-constants'
import type { ProcedureSite } from '@/lib/procedures/sites-helpers'

interface BotoxMuscleEditorProps {
  value: ProcedureSite[]
  onChange: (v: ProcedureSite[]) => void
}

// Per-muscle injection-map editor for BOTOX. Each row is a treated muscle with
// side, injection points, and units. Reuses the shared ProcedureSite shape
// (label + laterality + points + units); volume/target_confirmed_imaging stay null.
export function BotoxMuscleEditor({ value, onChange }: BotoxMuscleEditorProps) {
  function addMuscle(label: string) {
    onChange([
      ...value,
      { label, laterality: null, volume_ml: null, target_confirmed_imaging: null, points: null, units: null },
    ])
  }

  function removeMuscle(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  function updateMuscle(idx: number, patch: Partial<ProcedureSite>) {
    onChange(value.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  return (
    <div className="space-y-3">
      {/* Muscle picker */}
      <Select
        value=""
        onValueChange={(label) => { if (label) addMuscle(label) }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Add a muscle..." />
        </SelectTrigger>
        <SelectContent>
          {BOTOX_MUSCLE_OPTIONS.map((m) => (
            <SelectItem key={m.value} value={m.label}>{m.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Per-muscle rows */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((site, idx) => (
            <div key={`${site.label}-${site.laterality ?? ''}-${idx}`} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="secondary">{site.label}</Badge>
                <button
                  type="button"
                  onClick={() => removeMuscle(idx)}
                  aria-label={`Remove ${site.label}`}
                  className="rounded-full hover:bg-muted p-1"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Side</label>
                  <Select
                    value={site.laterality ?? ''}
                    onValueChange={(v) =>
                      updateMuscle(idx, {
                        laterality: v === '' ? null : (v as 'left' | 'right' | 'bilateral'),
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                      <SelectItem value="bilateral">Bilateral</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Points</label>
                  <Input
                    type="number"
                    min={1}
                    step="1"
                    placeholder="pts"
                    value={site.points ?? ''}
                    onChange={(e) =>
                      updateMuscle(idx, {
                        points: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Units</label>
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    placeholder="U"
                    value={site.units ?? ''}
                    onChange={(e) =>
                      updateMuscle(idx, {
                        units: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
