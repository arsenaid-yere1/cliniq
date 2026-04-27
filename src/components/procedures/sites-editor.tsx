'use client'

import { useState, useRef } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { SITE_CATALOG } from '@/lib/procedures/site-catalog'
import type { ProcedureSite } from '@/lib/procedures/sites-helpers'

interface SitesEditorProps {
  value: ProcedureSite[]
  onChange: (v: ProcedureSite[]) => void
  intakeSuggestions: string[]
}

export function SitesEditor({ value, onChange, intakeSuggestions }: SitesEditorProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedLabels = new Set(value.map((s) => s.label.toLowerCase()))
  // Suggestions = intake first, then catalog. Filter by query and dedupe against selected.
  const all = Array.from(new Set([...intakeSuggestions, ...SITE_CATALOG]))
  const filtered = all.filter((label) => {
    if (selectedLabels.has(label.toLowerCase())) return false
    if (!query) return true
    return label.toLowerCase().includes(query.toLowerCase())
  })
  const showAddOption =
    query.trim() !== '' && !selectedLabels.has(query.trim().toLowerCase())

  function addSite(label: string) {
    onChange([
      ...value,
      { label, laterality: null, volume_ml: null, target_confirmed_imaging: null },
    ])
    setQuery('')
    inputRef.current?.focus()
  }

  function removeSite(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  function updateSite(idx: number, patch: Partial<ProcedureSite>) {
    onChange(value.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  return (
    <div className="space-y-3">
      {/* Combobox */}
      <div className="relative">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (filtered.length === 1) addSite(filtered[0])
              else if (showAddOption) addSite(query.trim())
            }
          }}
          placeholder="Add a site (e.g. Knee, L4-L5, Shoulder)"
          autoComplete="off"
        />
        {open && (filtered.length > 0 || showAddOption) && (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
            <ul className="max-h-48 overflow-auto py-1 text-sm">
              {filtered.slice(0, 50).map((label) => (
                <li key={label}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      addSite(label)
                    }}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent"
                  >
                    {label}
                  </button>
                </li>
              ))}
              {showAddOption && (
                <li>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      addSite(query.trim())
                    }}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent text-xs"
                  >
                    Add &ldquo;{query.trim()}&rdquo;
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* Per-site rows */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((site, idx) => (
            <div key={`${site.label}-${idx}`} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="secondary">{site.label}</Badge>
                <button
                  type="button"
                  onClick={() => removeSite(idx)}
                  aria-label={`Remove ${site.label}`}
                  className="rounded-full hover:bg-muted p-1"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Laterality</label>
                  <Select
                    value={site.laterality ?? ''}
                    onValueChange={(v) =>
                      updateSite(idx, {
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
                  <label className="text-xs text-muted-foreground">Volume (mL)</label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="optional"
                    value={site.volume_ml ?? ''}
                    onChange={(e) =>
                      updateSite(idx, {
                        volume_ml: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <Checkbox
                    checked={site.target_confirmed_imaging ?? false}
                    onCheckedChange={(checked) =>
                      updateSite(idx, {
                        target_confirmed_imaging: checked === true ? true : null,
                      })
                    }
                    id={`tci-${idx}`}
                  />
                  <label htmlFor={`tci-${idx}`} className="text-xs cursor-pointer">
                    Target confirmed on imaging
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
