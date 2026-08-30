'use client'

import { useState, useRef } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PrpDiagnosis } from '@/lib/validations/prp-procedure'
import { validateIcd10Code, classifyIcd10Code } from '@/lib/icd10/validation'

type DiagnosisSuggestion = {
  icd10_code: string | null
  description: string
  imaging_support?: 'confirmed' | 'referenced' | 'none' | null
  exam_support?: 'objective' | 'subjective_only' | 'none' | null
  source_quote?: string | null
}

interface DiagnosisComboboxProps {
  value: PrpDiagnosis[]
  onChange: (v: PrpDiagnosis[]) => void
  suggestions: DiagnosisSuggestion[]
}

// A myelopathy/radiculopathy suggestion with imaging_support="none" OR
// exam_support lacking "objective" has no correlative support from the PM
// extraction and will get filtered/downgraded at note-generation time. Warn
// the reviewer before committing it.
function unsupportedReason(s: DiagnosisSuggestion): string | null {
  const family = classifyIcd10Code(s.icd10_code)
  if (family === 'other') return null
  const noImaging = s.imaging_support === 'none'
  const noObjective = s.exam_support !== 'objective'
  if (family === 'myelopathy' && noObjective) {
    return 'Myelopathy code lacks objective UMN-sign support — note generation will downgrade to M50.20.'
  }
  if (family === 'radiculopathy' && (noImaging || noObjective)) {
    return 'Radiculopathy code lacks region-matched objective support — note generation will downgrade to M50.20 / M51.36 / M51.37.'
  }
  return null
}

export function DiagnosisCombobox({ value, onChange, suggestions }: DiagnosisComboboxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedCodes = new Set(value.map((d) => d.icd10_code))

  const filtered = suggestions.filter((s) => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      s.icd10_code?.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    )
  })

  function selectSuggestion(s: { icd10_code: string | null; description: string }) {
    if (!s.icd10_code || selectedCodes.has(s.icd10_code)) return
    const v = validateIcd10Code(s.icd10_code)
    if (!v.ok && v.reason === 'non_billable_parent' && v.suggestion) {
      setValidationError(
        `${v.code} is a non-billable parent; using ${v.suggestion}. Edit the description if a different subcode applies.`,
      )
      if (selectedCodes.has(v.suggestion)) {
        setQuery('')
        return
      }
      onChange([...value, { icd10_code: v.suggestion, description: s.description }])
      setQuery('')
      inputRef.current?.focus()
      return
    }
    setValidationError(null)
    onChange([...value, { icd10_code: s.icd10_code, description: s.description }])
    setQuery('')
    inputRef.current?.focus()
  }

  function addFreeText() {
    const trimmed = query.trim()
    if (!trimmed) return

    // Try to parse "CODE description" or just treat whole thing as description
    const match = trimmed.match(/^([A-Z][0-9A-Z.]{1,6})\s+(.+)$/i)
    let icd10_code: string
    let description: string
    if (match) {
      icd10_code = match[1].toUpperCase()
      description = match[2]
    } else {
      icd10_code = trimmed.toUpperCase()
      description = trimmed
    }

    const v = validateIcd10Code(icd10_code)
    if (!v.ok && v.reason === 'structure') {
      setValidationError(`"${icd10_code}" is not a valid ICD-10 code format`)
      return
    }
    if (!v.ok && v.reason === 'non_billable_parent' && v.suggestion) {
      setValidationError(
        `${icd10_code} is a non-billable parent; using ${v.suggestion}. Edit the description if a different subcode applies.`,
      )
      icd10_code = v.suggestion
    } else {
      setValidationError(null)
    }

    if (selectedCodes.has(icd10_code)) {
      setQuery('')
      return
    }

    onChange([...value, { icd10_code, description }])
    setQuery('')
    inputRef.current?.focus()
  }

  function remove(code: string) {
    onChange(value.filter((d) => d.icd10_code !== code))
  }

  const showAddOption = query.trim() !== '' && filtered.length === 0

  return (
    <div className="space-y-2">
      {/* Selected badges */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((d) => (
            <Badge key={d.icd10_code} variant="secondary" className="gap-1">
              <span className="font-mono text-xs">{d.icd10_code}</span>
              <span className="text-xs">{d.description}</span>
              <button
                type="button"
                onClick={() => remove(d.icd10_code)}
                className="ml-1 rounded-full hover:bg-muted"
                aria-label={`Remove ${d.icd10_code}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Input + dropdown */}
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
              if (filtered.length === 1 && !selectedCodes.has(filtered[0].icd10_code ?? '')) {
                selectSuggestion(filtered[0])
              } else if (showAddOption) {
                addFreeText()
              }
            }
          }}
          placeholder="Search ICD-10 codes or type to add..."
          autoComplete="off"
        />
        {validationError && (
          <p className="mt-1 text-xs text-destructive" role="alert">
            {validationError}
          </p>
        )}

        {open && (filtered.length > 0 || showAddOption) && (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
            <ul className="max-h-48 overflow-auto py-1 text-sm">
              {filtered.map((s) => {
                const isSelected = selectedCodes.has(s.icd10_code ?? '')
                const warn = unsupportedReason(s)
                return (
                  <li key={s.icd10_code ?? s.description}>
                    <button
                      type="button"
                      disabled={isSelected}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        selectSuggestion(s)
                      }}
                      className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent disabled:opacity-50"
                      title={warn ?? undefined}
                    >
                      <span className="font-mono text-xs text-muted-foreground">{s.icd10_code}</span>
                      <span className="text-xs">{s.description}</span>
                      {warn && (
                        <AlertTriangle
                          className="h-3 w-3 shrink-0 text-amber-600"
                          aria-label="Support evidence weak"
                        />
                      )}
                      {isSelected && <span className="ml-auto text-xs text-muted-foreground">Added</span>}
                    </button>
                  </li>
                )
              })}
              {showAddOption && (
                <li>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start px-3 py-1.5 text-xs"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      addFreeText()
                    }}
                  >
                    Add &ldquo;{query.trim()}&rdquo;
                  </Button>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
