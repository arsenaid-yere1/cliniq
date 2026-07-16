// Pure BOTOX invoice-line construction. Extracted from billing.ts (a 'use server'
// module that can only export async functions) so it can be unit-tested directly.

export interface BotoxDosing {
  units_administered?: number
  units_discarded?: number
  reconstitution_units?: number
}

export interface BotoxLineItem {
  procedure_id: string
  service_date: string
  cpt_code: string
  description: string
  quantity: number
  unit_price: number
  total_price: number
}

export interface BotoxLineInputs {
  procedureId: string
  procedureDate: string
  injectionSite?: string | null
  dosing: BotoxDosing | null | undefined
  unitCode: string
  unitPrice: number
}

// Per-unit administration line + separate waste line (JW-style). Units reconcile
// to the vial: administered + discarded === reconstitution_units (enforced at the
// form layer; here we simply bill each). Lines are omitted when their unit count is 0.
export function computeBotoxDrugLineItems(input: BotoxLineInputs): BotoxLineItem[] {
  const d = input.dosing ?? {}
  const administered = Number(d.units_administered ?? 0)
  const discarded = Number(d.units_discarded ?? 0)
  const muscleText = input.injectionSite ? `\n${input.injectionSite}` : ''
  const lines: BotoxLineItem[] = []

  if (administered > 0) {
    lines.push({
      procedure_id: input.procedureId,
      service_date: input.procedureDate,
      cpt_code: input.unitCode,
      description: `BOTOX onabotulinumtoxinA administered${muscleText}`,
      quantity: administered,
      unit_price: input.unitPrice,
      total_price: input.unitPrice * administered,
    })
  }
  if (discarded > 0) {
    lines.push({
      procedure_id: input.procedureId,
      service_date: input.procedureDate,
      cpt_code: input.unitCode,
      description: 'Unavoidable discarded BOTOX drug allocation (JW)',
      quantity: discarded,
      unit_price: input.unitPrice,
      total_price: input.unitPrice * discarded,
    })
  }
  return lines
}

export function computeBotoxFacilityLineItem(input: {
  procedureId: string
  procedureDate: string
  facilityCode: string
  facilityPrice: number
}): BotoxLineItem {
  return {
    procedure_id: input.procedureId,
    service_date: input.procedureDate,
    cpt_code: input.facilityCode,
    description: 'BOTOX procedure-room/site utilization and disposables',
    quantity: 1,
    unit_price: input.facilityPrice,
    total_price: input.facilityPrice,
  }
}
