import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { visitDecisionClosing, type VisitTreatmentDecision } from '@/lib/validations/visit-treatment-decision'
import { initialVisitSections } from '@/lib/validations/initial-visit-note'
import { dischargeNoteSections } from '@/lib/validations/discharge-note'
import { InitialVisitPdf, type InitialVisitPdfData } from '../initial-visit-template'
import { DischargeNotePdf, type DischargeNotePdfData } from '../discharge-note-template'
import { PainFollowUpPdf, type PainFollowUpPdfData } from '../pain-follow-up-template'

const header = { patientName: 'Test Patient', dob: '01/01/1980', dateOfService: '09/10/2026', dateOfInjury: '09/01/2026', reasonForVisit: 'Follow-up', visitType: 'Evaluation', age: 46 }
const decisions: VisitTreatmentDecision[] = [
  { decision: 'accepted', details: null },
  { decision: 'partially_accepted', details: 'Exercise only; injection deferred.' },
  { decision: 'deferred', details: null },
  { decision: 'declined', details: null },
  { decision: 'not_documented', details: null },
]
describe('saved visit decision PDF text', () => {
  it.each(['initial', 'pain evaluation', 'follow-up', 'discharge'])('preserves all decision variants in %s PDFs without adding consent or understanding', async (family) => {
    for (const decision of decisions) {
      const closing = visitDecisionClosing(decision)
      const education = ['Home exercise was reviewed.', closing].filter(Boolean).join('\n\n')
      const initial = { ...header, ...Object.fromEntries(initialVisitSections.map((key) => [key, null])), patient_education: education, treatment_plan: 'Home exercise', visitType: family } as InitialVisitPdfData
      const discharge = { ...header, ...Object.fromEntries(dischargeNoteSections.map((key) => [key, null])), patient_education: education, plan_and_recommendations: 'Home exercise' } as unknown as DischargeNotePdfData
      const followUp = { ...header, modality: 'Telehealth', consent: 'Not documented', patientLocation: 'Not documented', providerLocation: 'Not documented', connectionMethod: 'Not documented', providerName: 'Test Clinician', providerCredentials: null, providerNpi: null, sections: [{ label: 'Patient Education', value: education }] } as PainFollowUpPdfData
      const element = family === 'discharge' ? <DischargeNotePdf data={discharge} /> : family === 'follow-up' ? <PainFollowUpPdf data={followUp} /> : <InitialVisitPdf data={initial} />
      const buffer = await renderToBuffer(element)
      const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise
      const text = (await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
        const content = await (await pdf.getPage(index + 1)).getTextContent()
        return content.items.map((item) => 'str' in item ? item.str : '').join(' ')
      }))).join(' ').replace(/\s+/g, ' ')
      if (closing) expect(text).toContain(closing)
      else expect(text).not.toContain('The patient agreed')
      expect(text).not.toContain('verbalized understanding')
      expect(text).not.toContain('written consent')
      expect(text).not.toContain('confirmed_by')
      await pdf.destroy()
    }
  })
})
