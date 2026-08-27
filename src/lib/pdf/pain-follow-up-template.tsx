import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'

export interface PainFollowUpPdfData {
  clinicName?: string
  clinicAddress?: string
  clinicPhone?: string
  clinicFax?: string
  clinicLogoBase64?: string

  patientName: string
  dob: string
  dateOfService: string
  modality: string
  consent: string
  patientLocation: string
  providerLocation: string
  connectionMethod: string

  providerName: string
  providerCredentials?: string | null
  providerNpi?: string | null
  providerSignatureBase64?: string

  sections: Array<{ label: string; value: string | null }>
}

const styles = StyleSheet.create({
  page: { padding: 50, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.5 },
  clinicHeader: { textAlign: 'center', alignItems: 'center', marginBottom: 10 },
  clinicDetail: { fontSize: 9, color: '#444' },
  logo: { height: 80, marginBottom: 6 },
  separator: { borderBottomWidth: 1, borderBottomColor: '#ccc', borderBottomStyle: 'solid', marginTop: 10, marginBottom: 10 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 15, textAlign: 'center', marginBottom: 14 },
  patientInfoRow: { flexDirection: 'row', marginBottom: 2 },
  patientLabel: { fontFamily: 'Helvetica-Bold', width: 110 },
  sectionHeading: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 14, marginBottom: 4 },
  sectionBody: { fontSize: 10, lineHeight: 1.6 },
  signatureBlock: { marginTop: 24 },
  signatureImage: { height: 40, width: 120, marginBottom: 4 },
  providerName: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  providerDetail: { fontSize: 9, color: '#666' },
})

function renderInlineText(text: string, baseStyle: Style) {
  const parts = text.split(/\*\*(.+?)\*\*/)
  if (parts.length === 1) return <Text style={baseStyle}>{text}</Text>

  return (
    <Text style={baseStyle}>
      {parts.map((part, index) => index % 2 === 1
        ? <Text key={index} style={{ fontFamily: 'Helvetica-Bold' }}>{part}</Text>
        : <Text key={index}>{part}</Text>)}
    </Text>
  )
}

function isSubHeading(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.endsWith(':') || trimmed.length > 80) return false
  const letters = trimmed.replace(/[^a-zA-Z]/g, '')
  if (!letters) return false
  const upperCount = (letters.match(/[A-Z]/g) || []).length
  return upperCount / letters.length > 0.6
}

function ParagraphBody({ content }: { content: string }) {
  return (
    <View>
      {content.split('\n').map((line, lineIndex) => {
        const trimmed = line.trim()
        if (!trimmed) return null

        const bulletMatch = trimmed.match(/^(?:\u2022\s*|-\s+|\*\s+)(.*)$/)
        if (bulletMatch) {
          return (
            <View key={lineIndex} style={{ flexDirection: 'row', marginLeft: 12, marginBottom: 1 }}>
              <Text style={[styles.sectionBody, { width: 12 }]}>{'\u2022'}</Text>
              <View style={{ flex: 1 }}>{renderInlineText(bulletMatch[1], styles.sectionBody)}</View>
            </View>
          )
        }

        if (isSubHeading(trimmed)) {
          return (
            <Text
              key={lineIndex}
              style={[styles.sectionBody, { fontFamily: 'Helvetica-Bold', marginTop: lineIndex > 0 ? 6 : 0, marginBottom: 2 }]}
            >
              {trimmed.replace(/\*\*/g, '')}
            </Text>
          )
        }

        return <View key={lineIndex}>{renderInlineText(trimmed, styles.sectionBody)}</View>
      })}
    </View>
  )
}

function SectionBody({ content }: { content: string }) {
  return (
    <View>
      {content.split(/\n\n+/).map((paragraph, paragraphIndex) => (
        <View key={paragraphIndex} style={paragraphIndex > 0 ? { marginTop: 6 } : {}}>
          <ParagraphBody content={paragraph} />
        </View>
      ))}
    </View>
  )
}

export function PainFollowUpPdf({ data }: { data: PainFollowUpPdfData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.clinicHeader}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- React-PDF Image does not support HTML alt props. */}
          {data.clinicLogoBase64 && <Image src={data.clinicLogoBase64} style={styles.logo} />}
          {data.clinicAddress && <Text style={styles.clinicDetail}>{data.clinicAddress}</Text>}
          {(data.clinicPhone || data.clinicFax) && (
            <Text style={styles.clinicDetail}>
              {data.clinicPhone && `Tel: ${data.clinicPhone}`}
              {data.clinicPhone && data.clinicFax && ' | '}
              {data.clinicFax && `Fax: ${data.clinicFax}`}
            </Text>
          )}
        </View>

        <View style={styles.separator} />

        <Text style={styles.title}>Pain Management Follow-Up</Text>
        <View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Patient:</Text><Text>{data.patientName}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>DOB:</Text><Text>{data.dob}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Date of Service:</Text><Text>{data.dateOfService}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Modality:</Text><Text>{data.modality}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Consent:</Text><Text>{data.consent}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Patient Location:</Text><Text>{data.patientLocation}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Provider Location:</Text><Text>{data.providerLocation}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Connection:</Text><Text>{data.connectionMethod}</Text></View>
        </View>

        <View style={styles.separator} />

        {data.sections.map((section) => {
          if (!section.value) return null
          const [firstParagraph, ...remainingParagraphs] = section.value.split(/\n\n+/)
          return (
            <View key={section.label}>
              <View wrap={false}>
                <Text style={styles.sectionHeading}>{section.label}</Text>
                <ParagraphBody content={firstParagraph} />
              </View>
              {remainingParagraphs.length > 0 && (
                <View style={{ marginTop: 6 }}>
                  <SectionBody content={remainingParagraphs.join('\n\n')} />
                </View>
              )}
            </View>
          )
        })}

        <View style={styles.separator} />

        <View style={styles.signatureBlock} wrap={false}>
          <Text style={styles.sectionBody}>Respectfully,</Text>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- React-PDF Image does not support HTML alt props. */}
          {data.providerSignatureBase64 && <Image src={data.providerSignatureBase64} style={styles.signatureImage} />}
          <Text style={styles.providerName}>
            {data.providerName}{data.providerCredentials && `, ${data.providerCredentials}`}
          </Text>
          {data.providerNpi && <Text style={styles.providerDetail}>NPI: {data.providerNpi}</Text>}
        </View>
      </Page>
    </Document>
  )
}
