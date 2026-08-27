export function sortInvoiceLineItemsChronologically<T extends { service_date: string }>(
  lineItems: T[],
): T[] {
  return lineItems
    .map((lineItem, index) => ({ lineItem, index }))
    .sort((a, b) => {
      const dateComparison = a.lineItem.service_date.localeCompare(b.lineItem.service_date)
      return dateComparison !== 0 ? dateComparison : a.index - b.index
    })
    .map(({ lineItem }) => lineItem)
}
