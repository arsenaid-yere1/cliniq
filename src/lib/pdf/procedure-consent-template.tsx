import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import {
  nsaidPostCareInstructionSentence,
  nsaidScreeningContraindicationLabel,
} from '@/lib/clinical/prp-protocol'

export interface ProcedureConsentPdfData {
  clinicLogoBase64?: string
  clinicName?: string
  clinicAddress?: string
  clinicPhone?: string
  clinicFax?: string

  patientName: string
  dateOfBirth: string
  caseNumber: string
  dateOfService: string

  providerLine: string

  // Procedure-specific (optional — when launched from procedure dialog)
  treatmentArea?: string
  laterality?: 'left' | 'right' | 'bilateral'
  procedureNumber?: number
}

const styles = StyleSheet.create({
  page: { padding: 50, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.5 },
  clinicHeader: { alignItems: 'center', marginBottom: 16 },
  logo: { height: 80, marginBottom: 6 },
  clinicAddress: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  clinicDetail: { fontSize: 9 },
  fieldRow: { flexDirection: 'row', marginBottom: 4 },
  fieldLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  fieldValue: { fontSize: 10 },
  fieldRowSpaced: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 12, textAlign: 'center', marginTop: 16, marginBottom: 12, textDecoration: 'underline' },
  paragraph: { fontSize: 10, marginBottom: 8, textAlign: 'justify' },
  sectionHeading: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 14, marginBottom: 6 },
  checklistTwoCol: { flexDirection: 'row', flexWrap: 'wrap' },
  checklistRow: { flexDirection: 'row', marginBottom: 3, width: '50%' },
  checklistItem: { fontSize: 9, flex: 1 },
  initialLine: { fontSize: 9, marginBottom: 4 },
  ackLine: { fontSize: 9, marginTop: 4, marginBottom: 4 },
  underlineField: { borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', minWidth: 120, fontSize: 10 },
  signatureSection: { marginTop: 24 },
  signatureRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  signatureBlock: { flexDirection: 'row', alignItems: 'flex-end' },
  signatureLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  signatureLine: { fontSize: 10, borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', width: 160, marginLeft: 4, marginRight: 16 },
  dateLine: { fontSize: 10, borderBottomWidth: 1, borderBottomColor: '#000', borderBottomStyle: 'solid', width: 120, marginLeft: 4 },
  dateLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
})

const PROCEDURE_DESC_PARAGRAPH =
  'Platelet-Rich Plasma (PRP) therapy is an autologous treatment in which a small volume of the patient\'s own blood is drawn and processed through centrifugation to concentrate platelets and growth factors. The resulting platelet-rich plasma is then re-injected into the targeted area of injury or degeneration to promote healing, reduce inflammation, and support tissue repair. The procedure is typically performed in-office under local anesthesia and may be guided by ultrasound or anatomic landmarks.'

const BENEFITS_PARAGRAPH =
  'The expected benefits of PRP therapy may include reduction of pain, improvement in function, and stimulation of the body\'s natural healing response. However, individual results vary and benefits cannot be guaranteed. Alternatives to PRP injection include — but are not limited to — corticosteroid injection, hyaluronic acid (viscosupplementation) injection, surgical intervention, physical therapy, and continued conservative care (rest, activity modification, oral medications).'

const POST_CARE_INTRO =
  'Following your PRP injection, please observe the post-procedure instructions below to optimize healing and minimize risk of complications:'

export const POST_CARE_ITEMS = [
  nsaidPostCareInstructionSentence(),
  'Do not apply ice to the injection site for at least 72 hours.',
  'Observe activity restrictions as directed by your provider; avoid strenuous activity involving the treated area for the recommended period.',
  'Attend all scheduled follow-up appointments and notify the clinic of any signs of infection, severe pain, or unexpected reactions.',
]

export const CONTRAINDICATION_ITEMS = [
  'Active infection at injection site',
  'Active cancer / chemotherapy / radiation',
  'Blood clotting disorder (thrombocytopenia, hemophilia)',
  'Anticoagulants (Eliquis, Xarelto, Coumadin, etc.)',
  'Antiplatelet drugs (Plavix, daily aspirin)',
  nsaidScreeningContraindicationLabel(),
  'Systemic corticosteroids in past 2 weeks',
  'Pregnancy',
  'Known allergy to local anesthetic',
  'Previous adverse reaction to PRP',
]

const RISK_ITEMS = [
  'Local discomfort, swelling, bruising at the injection site',
  'Infection',
  'Nerve or vascular injury',
  'Allergic or hypersensitivity reaction',
  'Post-injection flare (increased pain 24–72 hours after injection)',
  'No guarantee of relief or cure',
  'Possible need for repeat injections',
  'PRP is considered investigational and is not FDA-approved for all musculoskeletal indications',
]

const lateralityLabel = (l?: 'left' | 'right' | 'bilateral') => {
  if (!l) return ''
  if (l === 'left') return 'Left'
  if (l === 'right') return 'Right'
  return 'Bilateral'
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function ProcedureConsentPdf({ data }: { data: ProcedureConsentPdfData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Section A — Clinic Header & Patient Identity */}
        <View style={styles.clinicHeader}>
          {data.clinicLogoBase64 && <Image src={data.clinicLogoBase64} style={styles.logo} />}
          {data.clinicAddress && <Text style={styles.clinicAddress}>{data.clinicAddress}</Text>}
          {data.clinicPhone && data.clinicFax && (
            <Text style={styles.clinicDetail}>Tel: {data.clinicPhone}    Fax: {data.clinicFax}</Text>
          )}
          {data.clinicPhone && !data.clinicFax && (
            <Text style={styles.clinicDetail}>Tel: {data.clinicPhone}</Text>
          )}
          {!data.clinicPhone && data.clinicFax && (
            <Text style={styles.clinicDetail}>Fax: {data.clinicFax}</Text>
          )}
        </View>

        <Text style={styles.title}>INFORMED CONSENT FOR PLATELET-RICH PLASMA (PRP) INJECTION</Text>

        <View style={styles.fieldRowSpaced}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Patient Name: </Text>
            <Text style={styles.fieldValue}>{data.patientName}</Text>
          </View>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Date of Birth: </Text>
            <Text style={styles.fieldValue}>{data.dateOfBirth}</Text>
          </View>
        </View>

        <View style={styles.fieldRowSpaced}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Case Number: </Text>
            <Text style={styles.fieldValue}>{data.caseNumber}</Text>
          </View>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Date of Service: </Text>
            <Text style={styles.fieldValue}>{data.dateOfService}</Text>
          </View>
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Provider: </Text>
          <Text style={styles.fieldValue}>{data.providerLine}</Text>
        </View>

        {/* Section B — Procedure Description */}
        <Text style={styles.sectionHeading}>PROCEDURE DESCRIPTION</Text>
        <Text style={styles.paragraph}>{PROCEDURE_DESC_PARAGRAPH}</Text>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Treatment Area: </Text>
          <Text style={styles.fieldValue}>
            {data.treatmentArea ? data.treatmentArea : '________________________'}
          </Text>
        </View>
        <View style={styles.fieldRowSpaced}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Laterality: </Text>
            <Text style={styles.fieldValue}>
              {data.laterality ? lateralityLabel(data.laterality) : '________________'}
            </Text>
          </View>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Injection # in Series: </Text>
            <Text style={styles.fieldValue}>
              {data.procedureNumber ? ordinal(data.procedureNumber) : '__________'}
            </Text>
          </View>
        </View>

        {/* Section C — Contraindication Checklist */}
        <Text style={styles.sectionHeading}>CONTRAINDICATIONS — please check any that apply</Text>
        <View style={styles.checklistTwoCol}>
          {CONTRAINDICATION_ITEMS.map((item) => (
            <View key={item} style={styles.checklistRow}>
              <Text style={styles.checklistItem}>{'\u2610'}  {item}</Text>
            </View>
          ))}
        </View>

        {/* Section D — Risk Acknowledgments */}
        <Text style={styles.sectionHeading}>RISKS — please initial each item to acknowledge</Text>
        {RISK_ITEMS.map((risk) => (
          <Text key={risk} style={styles.initialLine}>_____  {risk}</Text>
        ))}

        {/* Section E — Benefits & Alternatives */}
        <Text style={styles.sectionHeading}>BENEFITS & ALTERNATIVES</Text>
        <Text style={styles.paragraph}>{BENEFITS_PARAGRAPH}</Text>
        <Text style={styles.ackLine}>{'\u2610'}  I acknowledge I have read and understood this section.</Text>

        {/* Section F — Post-Procedure Instructions */}
        <Text style={styles.sectionHeading}>POST-PROCEDURE INSTRUCTIONS</Text>
        <Text style={styles.paragraph}>{POST_CARE_INTRO}</Text>
        {POST_CARE_ITEMS.map((item) => (
          <Text key={item} style={styles.initialLine}>•  {item}</Text>
        ))}
        <Text style={styles.ackLine}>{'\u2610'}  I acknowledge I have read and understood this section.</Text>

        {/* Section G — Photo/Video Authorization */}
        <Text style={styles.sectionHeading}>PHOTO / VIDEO AUTHORIZATION</Text>
        <Text style={styles.ackLine}>{'\u2610'}  I authorize the use of de-identified photos/videos for clinical documentation and education.</Text>

        {/* Section H — Signature Block */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureRow}>
            <View style={styles.signatureBlock}>
              <Text style={styles.signatureLabel}>PATIENT SIGNATURE</Text>
              <Text style={styles.signatureLine}> </Text>
            </View>
            <View style={styles.signatureBlock}>
              <Text style={styles.dateLabel}>DATE</Text>
              <Text style={styles.dateLine}> </Text>
            </View>
          </View>

          <View style={styles.signatureRow}>
            <View style={styles.signatureBlock}>
              <Text style={styles.signatureLabel}>PRINTED NAME</Text>
              <Text style={styles.signatureLine}> </Text>
            </View>
          </View>

          <View style={styles.signatureRow}>
            <View style={styles.signatureBlock}>
              <Text style={styles.signatureLabel}>PROVIDER SIGNATURE</Text>
              <Text style={styles.signatureLine}> </Text>
            </View>
            <View style={styles.signatureBlock}>
              <Text style={styles.dateLabel}>DATE</Text>
              <Text style={styles.dateLine}> </Text>
            </View>
          </View>

          <View style={styles.signatureRow}>
            <View style={styles.signatureBlock}>
              <Text style={styles.signatureLabel}>CREDENTIALS</Text>
              <Text style={styles.signatureLine}> </Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  )
}
