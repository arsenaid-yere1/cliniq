import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { PainFollowUpPdf, type PainFollowUpPdfData } from '../pain-follow-up-template'

const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAYAAAD/Rn+7AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAQUlEQVR4nO2UQQ0AQAzCJgJhCMPznQy2pA/+TQOMnLc50wYQgMZg6j0TIzEGU++aOGpjMCszbQABaAym3jNdHskH/9cLOwj8VgkAAAAASUVORK5CYII='

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise
  const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
    const page = await pdf.getPage(index + 1)
    const content = await page.getTextContent()
    return content.items.map((item) => 'str' in item ? item.str : '').join(' ')
  }))
  return pages.join('\n').replace(/\s+/g, ' ').trim()
}

const data: PainFollowUpPdfData = {
  clinicName: 'Cliniq',
  clinicAddress: '100 Main Street, Los Angeles, CA 90001',
  clinicPhone: '(555) 010-2000',
  clinicFax: '(555) 010-2001',
  clinicLogoBase64: samplePng,
  patientName: 'Test Patient',
  dob: '01/02/1980',
  dateOfService: '08/27/2026',
  modality: 'Telehealth (audio/video)',
  consent: 'Obtained',
  patientLocation: 'California',
  providerLocation: 'Los Angeles clinic',
  connectionMethod: 'Secure video',
  providerName: 'Jordan Clinician',
  providerCredentials: 'MD',
  providerNpi: '1234567890',
  providerSignatureBase64: samplePng,
  sections: [
    { label: 'Assessment', value: 'Improving after PRP.\n\nPLAN:\n- Continue home exercise.' },
  ],
}

describe('PainFollowUpPdf', () => {
  it('renders the standard clinic header, follow-up metadata, sections, and signed provider block', async () => {
    const element = React.createElement(PainFollowUpPdf, { data })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(element as any)
    const text = await extractPdfText(buffer)

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(text).toContain('100 Main Street, Los Angeles, CA 90001')
    expect(text).toContain('Tel: (555) 010-2000 | Fax: (555) 010-2001')
    expect(text).toContain('Pain Management Follow-Up')
    expect(text).toContain('Telehealth (audio/video)')
    expect(text).toContain('Improving after PRP.')
    expect(text).toContain('Respectfully,')
    expect(text).toContain('Jordan Clinician')
    expect(text).toContain('MD')
    expect(text).toContain('NPI: 1234567890')
  })

  it('renders when optional clinic assets and signature details are absent', async () => {
    const element = React.createElement(PainFollowUpPdf, {
      data: {
        ...data,
        clinicLogoBase64: undefined,
        providerSignatureBase64: undefined,
        providerCredentials: null,
        providerNpi: null,
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(element as any)
    const text = await extractPdfText(buffer)

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(text).toContain('Jordan Clinician')
    expect(text).not.toContain('NPI:')
  })
})
