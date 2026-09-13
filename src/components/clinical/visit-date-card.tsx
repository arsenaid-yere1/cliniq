'use client'

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
  helperText = 'Defaults to today. The note is generated with this date as the visit anchor.',
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
          className="w-[200px]"
          value={value}
          min={min ?? undefined}
          max={max ?? undefined}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{helperText}</p>
      </CardContent>
    </Card>
  )
}
