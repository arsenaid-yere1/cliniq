import { z } from 'zod'

export const procedureSiteSchema = z.object({
  label: z.string().min(1, 'Site label is required'),
  laterality: z.enum(['left', 'right', 'bilateral']).nullable(),
  volume_ml: z.number().positive().nullable(),
  target_confirmed_imaging: z.boolean().nullable(),
})

export type ProcedureSite = z.infer<typeof procedureSiteSchema>

// Compute a single laterality value from a sites[] array.
// - all sites same laterality → that value
// - mixed lateralities → 'mixed'
// - all null → null
export function lateralityFromSites(
  sites: ProcedureSite[],
): 'left' | 'right' | 'bilateral' | 'mixed' | null {
  const values = sites
    .map((s) => s.laterality)
    .filter((l): l is 'left' | 'right' | 'bilateral' => l !== null)
  if (values.length === 0) return null
  const set = new Set(values)
  if (set.size === 1) return [...set][0]
  return 'mixed'
}

// "Right Knee", "Bilateral Knee", "Knee" (no laterality), etc.
// Used to compose denormalized procedures.injection_site string.
export function labelWithLaterality(s: ProcedureSite): string {
  if (!s.laterality) return s.label
  const lat =
    s.laterality === 'left' ? 'Left' :
    s.laterality === 'right' ? 'Right' : 'Bilateral'
  return `${lat} ${s.label}`
}

// Denormalize: comma-joined string for legacy injection_site column.
export function injectionSiteFromSites(sites: ProcedureSite[]): string {
  return sites.map(labelWithLaterality).join(', ')
}

// Denormalize: derive total volume. When every site has volume_ml, returns
// the sum. When any site is null, returns the explicit total (caller
// supplies it — e.g. provider-entered).
export function totalVolumeFromSites(
  sites: ProcedureSite[],
  fallbackTotal: number | null,
): number | null {
  if (sites.length === 0) return fallbackTotal
  if (sites.every((s) => s.volume_ml !== null)) {
    return sites.reduce((acc, s) => acc + (s.volume_ml ?? 0), 0)
  }
  return fallbackTotal
}

// Parse a legacy comma-joined injection_site string into structured sites.
// Used by getProcedureDefaults for back-compat consumption from intake;
// mirrors the SQL backfill grammar.
export function sitesFromLegacyString(
  injectionSite: string | null,
  laterality: 'left' | 'right' | 'bilateral' | null,
): ProcedureSite[] {
  if (!injectionSite) return []
  const parts = injectionSite
    .split(/,|;|\/|&|\+|\s+and\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  return parts.map((label) => ({
    label,
    laterality,
    volume_ml: null,
    target_confirmed_imaging: null,
  }))
}

// Read a procedures.sites jsonb value safely. Returns [] when shape is
// invalid (defensive against legacy rows or migration races).
export function parseSitesJsonb(raw: unknown): ProcedureSite[] {
  if (!Array.isArray(raw)) return []
  const result: ProcedureSite[] = []
  for (const item of raw) {
    const parsed = procedureSiteSchema.safeParse(item)
    if (parsed.success) result.push(parsed.data)
  }
  return result
}
