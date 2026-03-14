// Canonical invoice status definitions
// All UI and server code should import from here

export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'void', 'overdue', 'uncollectible'] as const
export type InvoiceStatus = typeof INVOICE_STATUSES[number]

export const TERMINAL_STATUSES: InvoiceStatus[] = ['paid', 'void', 'uncollectible']

export const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['issued', 'void'],
  issued: ['paid', 'overdue', 'void'],
  overdue: ['paid', 'uncollectible'],
  paid: [],
  void: [],
  uncollectible: [],
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  paid: 'Paid',
  void: 'Void',
  overdue: 'Overdue',
  uncollectible: 'Uncollectible',
}

export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  issued: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  paid: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800',
  void: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  overdue: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  uncollectible: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
}

export function isTerminalStatus(status: InvoiceStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export function canTransitionTo(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}
