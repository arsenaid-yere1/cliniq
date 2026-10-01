'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface VisitDateCardProps {
  id?: string
  value: string
  onChange: (v: string) => void
  min?: string | null
  max?: string | null
  disabled?: boolean
  label?: string
  onBlur?: () => void
  saveStatus?: string
  error?: string
  saving?: boolean
  savedConflictDate?: string
  onRetry?: () => void
  onUseSaved?: () => void
  onKeepMine?: () => void
  helperText?: string
}

export function VisitDateCard({
  id = 'visit-date-pre-gen',
  value,
  onChange,
  min,
  max,
  disabled,
  label = 'Date of Visit',
  onBlur, saveStatus, error, saving, savedConflictDate, onRetry, onUseSaved, onKeepMine,
  helperText = 'Changes save when you leave this field. Wait for Date saved before leaving the visit.',
}: VisitDateCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor={id} className="sr-only">
          {label}
        </Label>
        <Input
          id={id}
          type="date"
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-help ${id}-status${error ? ` ${id}-error` : ''}`}
          className="w-[200px]"
          value={value}
          min={min ?? undefined}
          max={max ?? undefined}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <p id={`${id}-help`} className="text-xs text-muted-foreground">{helperText}</p>
        <p id={`${id}-status`} role="status" className="text-xs text-muted-foreground">{saveStatus}</p>
        {error && <div id={`${id}-error`} className="space-y-2 text-sm text-destructive">
          <p>{error}</p>
          {savedConflictDate && <p>Saved date: {savedConflictDate}</p>}
          <div className="flex flex-wrap gap-2">
            {savedConflictDate ? <>
              <Button type="button" size="sm" variant="outline" disabled={disabled || saving} onClick={onUseSaved}>Use saved date</Button>
              <Button type="button" size="sm" variant="outline" disabled={disabled || saving} onClick={onKeepMine}>Keep my date</Button>
            </> : <Button type="button" size="sm" variant="outline" disabled={disabled || saving} onClick={onRetry}>Retry save</Button>}
          </div>
        </div>}
      </CardContent>
    </Card>
  )
}
