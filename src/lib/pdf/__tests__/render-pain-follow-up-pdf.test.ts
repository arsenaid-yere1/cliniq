import { beforeEach, describe, expect, it, vi } from 'vitest'

const renderToBuffer = vi.fn(async (document: unknown) => {
  void document
  return Buffer.from('%PDF follow-up')
})
const createClient = vi.fn()

vi.mock('@react-pdf/renderer', async (importOriginal) => {
  const original = await importOriginal<typeof import('@react-pdf/renderer')>()
  return { ...original, renderToBuffer }
})

vi.mock('@/lib/supabase/server', () => ({ createClient }))

const samplePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAYAAAD/Rn+7AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAQUlEQVR4nO2UQQ0AQAzCJgJhCMPznQy2pA/+TQOMnLc50wYQgMZg6j0TIzEGU++aOGpjMCszbQABaAym3jNdHskH/9cLOwj8VgkAAAAASUVORK5CYII=',
  'base64',
)

function queryResult(table: string) {
  if (table === 'cases') {
    return { data: { patient: { first_name: 'Test', last_name: 'Patient', date_of_birth: '1980-01-02' } } }
  }
  if (table === 'clinical_encounters') {
    return {
      data: {
        encounter_date: '2026-08-27',
        modality: 'telehealth',
        telehealth_consent_obtained: true,
        patient_location_state: 'California',
        provider_location: 'Los Angeles clinic',
        connection_method: 'Secure video',
        provider: {
          display_name: 'Jordan Clinician',
          credentials: 'MD',
          npi_number: '1234567890',
          signature_storage_path: 'signatures/provider.png',
        },
      },
    }
  }
  return {
    data: {
      clinic_name: 'Cliniq',
      address_line1: '100 Main Street',
      address_line2: null,
      city: 'Los Angeles',
      state: 'CA',
      zip_code: '90001',
      phone: '(555) 010-2000',
      fax: '(555) 010-2001',
      logo_storage_path: 'branding/logo.png',
    },
  }
}

describe('renderPainFollowUpPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClient.mockResolvedValue({
      from(table: string) {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          is: vi.fn(() => builder),
          single: vi.fn(async () => queryResult(table)),
          maybeSingle: vi.fn(async () => queryResult(table)),
        }
        return builder
      },
      storage: {
        from: vi.fn(() => ({
          download: vi.fn(async () => ({ data: new Blob([samplePng], { type: 'image/png' }) })),
        })),
      },
    })
  })

  it('passes clinic branding and the encounter signer snapshot into the PDF template', async () => {
    const { renderPainFollowUpPdf } = await import('../render-pain-follow-up-pdf')
    await renderPainFollowUpPdf('case-1', 'encounter-1', { assessment: 'Improving' })

    expect(renderToBuffer).toHaveBeenCalledOnce()
    const element = renderToBuffer.mock.calls[0][0] as unknown as {
      props: { data: Record<string, unknown> }
    }
    expect(element.props.data).toMatchObject({
      clinicName: 'Cliniq',
      clinicAddress: '100 Main Street, Los Angeles, CA 90001',
      clinicPhone: '(555) 010-2000',
      clinicFax: '(555) 010-2001',
      patientName: 'Test Patient',
      providerName: 'Jordan Clinician',
      providerCredentials: 'MD',
      providerNpi: '1234567890',
    })
    expect(element.props.data.clinicLogoBase64).toMatch(/^data:image\/png;base64,/)
    expect(element.props.data.providerSignatureBase64).toMatch(/^data:image\/png;base64,/)
  })
})
