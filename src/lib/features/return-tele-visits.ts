import 'server-only'

import { notFound } from 'next/navigation'

export const RETURN_TELE_VISITS_ENABLED =
  process.env.ENABLE_RETURN_TELE_VISITS === 'true'

export function requireReturnTeleVisitsPage() {
  if (!RETURN_TELE_VISITS_ENABLED) notFound()
}

export function requireReturnTeleVisitsMutation(): { error: string } | null {
  return RETURN_TELE_VISITS_ENABLED
    ? null
    : { error: 'Return tele-visits are not enabled' }
}
