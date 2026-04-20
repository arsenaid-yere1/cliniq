'use client'

import { useState, useRef } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'

interface CatalogItem {
  id: string
  cpt_code: string
  description: string
  default_price: number
}

interface CptCodeComboboxProps {
  value: string
  onChange: (value: string) => void
  onSelect: (item: CatalogItem) => void
  catalogItems: CatalogItem[]
  className?: string
  placeholder?: string
}

export function CptCodeCombobox({
  value,
  onChange,
  onSelect,
  catalogItems,
  className,
  placeholder = 'CPT',
}: CptCodeComboboxProps) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = catalogItems.filter((item) => {
    if (!value) return true
    const search = value.toLowerCase()
    return (
      item.cpt_code.toLowerCase().includes(search) ||
      item.description.toLowerCase().includes(search)
    )
  })

  return (
    <Popover open={open} onOpenChange={setOpen} modal={true}>
      <PopoverTrigger asChild>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          className={className}
          placeholder={placeholder}
          autoComplete="off"
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-[320px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No matching services</div>
          ) : (
            filtered.map((item) => (
              <button
                type="button"
                key={item.id}
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
                onClick={() => {
                  onSelect(item)
                  setOpen(false)
                  inputRef.current?.focus()
                }}
              >
                <span className="text-xs font-medium">{item.cpt_code}</span>
                <span className="text-xs text-muted-foreground truncate w-full">
                  {item.description} — ${Number(item.default_price).toFixed(2)}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
