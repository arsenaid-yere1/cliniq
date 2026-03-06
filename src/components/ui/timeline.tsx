import * as React from 'react'
import { cn } from '@/lib/utils'

const Timeline = React.forwardRef<HTMLOListElement, React.HTMLAttributes<HTMLOListElement>>(
  ({ className, ...props }, ref) => (
    <ol ref={ref} className={cn('relative space-y-6', className)} {...props} />
  ),
)
Timeline.displayName = 'Timeline'

const TimelineItem = React.forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
  ({ className, ...props }, ref) => (
    <li ref={ref} className={cn('relative flex gap-4', className)} {...props} />
  ),
)
TimelineItem.displayName = 'TimelineItem'

const TimelineDot = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { color?: string }
>(({ className, color, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background',
      color,
      className,
    )}
    {...props}
  >
    {children}
  </div>
))
TimelineDot.displayName = 'TimelineDot'

const TimelineConnector = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('absolute left-4 top-8 -translate-x-1/2 w-px bg-border', className)}
      style={{ height: 'calc(100% - 1rem)' }}
      {...props}
    />
  ),
)
TimelineConnector.displayName = 'TimelineConnector'

const TimelineContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex-1 pb-2', className)} {...props} />
  ),
)
TimelineContent.displayName = 'TimelineContent'

export { Timeline, TimelineItem, TimelineDot, TimelineConnector, TimelineContent }
