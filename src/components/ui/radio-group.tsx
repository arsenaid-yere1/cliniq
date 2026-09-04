'use client'

import * as React from 'react'
import { CircleIcon } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn('grid gap-2', className)} {...props} />
}

function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return <RadioGroupPrimitive.Item className={cn('aspect-square size-4 shrink-0 rounded-full border border-input text-primary shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50', className)} {...props}>
    <RadioGroupPrimitive.Indicator className="grid place-content-center"><CircleIcon className="size-2 fill-current" /></RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
}

export { RadioGroup, RadioGroupItem }
