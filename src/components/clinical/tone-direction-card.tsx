'use client'

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

interface ToneDirectionCardProps {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  disabled?: boolean
  description?: string
}

const DEFAULT_DESCRIPTION =
  "Provide optional guidance to influence the AI's writing style and emphasis. Applied to full generation and per-section regeneration."

export function ToneDirectionCard({
  value,
  onChange,
  onBlur,
  disabled,
  description,
}: ToneDirectionCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tone & Direction (optional)</CardTitle>
        <CardDescription>{description ?? DEFAULT_DESCRIPTION}</CardDescription>
      </CardHeader>
      <CardContent>
        <Textarea
          placeholder="e.g., Use assertive language about medical necessity, emphasize conservative treatment failure, keep prognosis cautious..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          rows={3}
          disabled={disabled}
        />
      </CardContent>
    </Card>
  )
}