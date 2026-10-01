'use client'

import { useState, useRef, type ComponentProps } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'

interface CatalogItem {
  id: string
  cpt_code: string
  description: string
  default_price: number
}

interface CptCodeComboboxProps extends Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'onSelect'> {
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
  ref, disabled, onFocus, ...inputProps
}: CptCodeComboboxProps) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const keyboardOpen = useRef(false)
  if (disabled && open) setOpen(false)

  const filtered = catalogItems.filter((item) => {
    if (!value) return true
    const search = value.toLowerCase()
    return (
      item.cpt_code.toLowerCase().includes(search) ||
      item.description.toLowerCase().includes(search)
    )
  })

  return (
    <Popover open={open && !disabled} onOpenChange={value => { if (!disabled) setOpen(value) }} modal={true}>
      <PopoverTrigger asChild>
        <Input
          {...inputProps}
          type="text"
          disabled={disabled}
          ref={node => {
            inputRef.current = node
            if (typeof ref === 'function') return ref(node)
            if (ref) ref.current = node
          }}
          value={value}
          onChange={(e) => {
            if (disabled) return
            onChange(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={onFocus}
          onKeyDown={event => {
            inputProps.onKeyDown?.(event)
            if (!disabled && event.key === 'ArrowDown') {
              event.preventDefault()
              if (open) contentRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
              else { keyboardOpen.current = true; setOpen(true) }
            }
          }}
          className={className}
          placeholder={placeholder}
          autoComplete="off"
        />
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        aria-label="CPT catalog"
        className="w-[280px] p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          if (keyboardOpen.current && !disabled) contentRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
          keyboardOpen.current = false
        }}
        onCloseAutoFocus={(e) => {
          // Prevent Radix from refocusing body (which can re-trigger the lockout)
          // and clear the pointer-events lock the parent Dialog's layer leaves
          // behind when a nested modal Popover closes.
          // https://github.com/radix-ui/primitives/issues/3445
          e.preventDefault()
          setTimeout(() => {
            document.body.style.pointerEvents = ''
          }, 0)
        }}
      >
        <div className="max-h-[320px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No matching services</div>
          ) : (
            filtered.map((item) => (
              <button
                type="button"
                disabled={disabled}
                key={item.id}
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
                onClick={() => {
                  if (disabled) return
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
