export function slugifyLastName(raw: string | null | undefined): string {
  if (!raw) return 'Unknown'
  const stripped = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return stripped.length > 0 ? stripped : 'Unknown'
}

export function formatFilenameDate(date: string | Date | null | undefined): string {
  if (!date) return new Date().toISOString().slice(0, 10)
  if (date instanceof Date) return date.toISOString().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10)
  return new Date(date).toISOString().slice(0, 10)
}

export function buildDownloadFilename(opts: {
  lastName: string | null | undefined
  docType: string
  date?: string | Date | null
  extra?: string
  extension?: string
}): string {
  const parts: string[] = [slugifyLastName(opts.lastName), opts.docType]
  if (opts.extra) parts.push(opts.extra)
  parts.push(formatFilenameDate(opts.date))
  const ext = opts.extension ?? 'pdf'
  return `${parts.join('_')}.${ext}`
}
