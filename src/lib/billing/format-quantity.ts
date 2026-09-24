/** Display saved quantities without recalculating billing or guessing unknown units. */
export function formatInvoiceQuantity(
  quantity: number,
  cptCode: string,
  description: string,
  invoiceType: string,
): string {
  if (invoiceType === 'facility') return String(quantity)

  const code = cptCode.trim().toUpperCase()
  let unit: string | undefined
  if (code === 'BOTOX-UNIT') {
    unit = 'unit'
  } else if (/^PRP\s+(?:preparation and injection|injection)\b/i.test(description.trim())) {
    // Codes alone cannot identify sites: facility lines share the PRP CPT codes.
    unit = 'site'
  } else if (code === '99204' || code === '99213') {
    unit = 'visit'
  }

  return unit ? `${quantity} ${unit}${quantity === 1 ? '' : 's'}` : String(quantity)
}
