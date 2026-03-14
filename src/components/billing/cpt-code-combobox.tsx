'use client'

import { useState, useRef } from 'react'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
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

  // Filter catalog items by CPT code or description
  const filtered = catalogItems.filter((item) => {
    if (!value) return true
    const search = value.toLowerCase()
    return (
      item.cpt_code.toLowerCase().includes(search) ||
      item.description.toLowerCase().includes(search)
    )
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty>No matching services</CommandEmpty>
            <CommandGroup>
              {filtered.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.cpt_code}
                  onSelect={() => {
                    onSelect(item)
                    setOpen(false)
                    inputRef.current?.focus()
                  }}
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">{item.cpt_code}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {item.description} — ${Number(item.default_price).toFixed(2)}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
