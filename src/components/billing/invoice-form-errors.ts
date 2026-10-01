import type { FieldPath } from 'react-hook-form'
import type { CreateInvoiceFormValues } from '@/lib/validations/invoice'

const labels: Record<string, string> = {
  invoice_type: 'Invoice type', invoice_date: 'Invoice date', claim_type: 'Claim type',
  indication: 'Indication', payee_name: 'Payee name', payee_address: 'Payee address', notes: 'Notes',
  service_date: 'Date', cpt_code: 'CPT', description: 'Description', quantity: 'Quantity', unit_price: 'Unit price',
  icd10_code: 'ICD-10',
}
export type InvoiceFormError = { key: string; label: string; message: string; field?: FieldPath<CreateInvoiceFormValues> }

/** Keep validation order aligned with the rendered form, including field-array indices. */
export function invoiceFormErrors(errors: unknown): InvoiceFormError[] {
  const result: InvoiceFormError[] = []
  function visit(value: unknown, path: string[]) {
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    const leaf = path.at(-1) ?? ''
    if (typeof node.message === 'string') {
      const arrayField = path[0] === 'line_items' || path[0] === 'diagnoses_snapshot'
      const editable = arrayField ? path.length === 3 && !!labels[leaf] : path.length === 1 && !!labels[leaf]
      result.push({ key: path.join('.'), message: node.message,
        label: arrayField ? `${path[0] === 'line_items' ? 'Item' : 'Diagnosis'}${/^\d+$/.test(path[1] ?? '') ? ` ${Number(path[1]) + 1}` : 's'}${labels[leaf] ? ` — ${labels[leaf]}` : ''}` : labels[leaf] ?? 'Invoice',
        field: editable ? path.join('.') as FieldPath<CreateInvoiceFormValues> : undefined })
    }
    const ordered = path.length === 0
      ? ['invoice_type', 'invoice_date', 'claim_type', 'indication', 'diagnoses_snapshot', 'line_items', 'payee_name', 'payee_address', 'notes', 'root']
      : path[0] === 'line_items' && path.length === 2
        ? ['service_date', 'cpt_code', 'description', 'quantity', 'unit_price', 'total_price', 'id', 'procedure_id', 'encounter_id', 'display_order', 'root']
        : Object.keys(node).filter(key => !['message', 'type', 'ref', 'types'].includes(key))
    for (const key of ordered) visit(node[key], [...path, key])
  }
  visit(errors, [])
  return result
}
