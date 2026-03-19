'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

const themes = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

export function AppearanceForm() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true))
  }, [])

  if (!mounted) return null

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Appearance</h3>
        <p className="text-sm text-muted-foreground">
          Choose how ClinIQ looks to you.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4 max-w-md">
        {themes.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            className={cn(
              'flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors hover:bg-accent',
              theme === value
                ? 'border-primary bg-accent'
                : 'border-transparent'
            )}
          >
            <Icon className="h-6 w-6" />
            <span className="text-sm font-medium">{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
