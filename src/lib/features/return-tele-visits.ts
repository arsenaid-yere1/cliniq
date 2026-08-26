import 'server-only'

import { notFound } from 'next/navigation'

// Return tele-visits are released by default. Operations can still disable the
// workflow immediately by setting the production flag to `false`.
export const RETURN_TELE_VISITS_ENABLED =
  process.env.ENABLE_RETURN_TELE_VISITS !== 'false'

export function requireReturnTeleVisitsPage() {
  if (!RETURN_TELE_VISITS_ENABLED) notFound()
}

export function requireReturnTeleVisitsMutation(): { error: string } | null {
  return RETURN_TELE_VISITS_ENABLED
    ? null
    : { error: 'Return tele-visits are not enabled' }
}
