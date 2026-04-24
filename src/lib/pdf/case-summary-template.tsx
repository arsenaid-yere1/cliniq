import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'

export interface CaseSummaryPdfData {
  // Clinic info
  clinicName?: string
  clinicAddress?: string
  clinicPhone?: string
  clinicFax?: string
  clinicLogoBase64?: string

  // Patient / case block
  patientName: string
  dob: string
  dateOfInjury: string
  accidentType: string | null

  // Summary metadata
  generatedAt: string
  reviewStatus: 'approved' | 'edited' | 'pending_review' | 'rejected'
  reviewedAt: string | null
  aiConfidence: 'high' | 'medium' | 'low' | null

  // Summary sections
  chiefComplaint: string | null
  imagingFindings: Array<{
    body_region: string
    summary: string
    key_findings: string[]
    severity: 'mild' | 'moderate' | 'severe' | null
  }>
  priorTreatment: {
    modalities: string[]
    total_visits: number | null
    treatment_period: string | null
    gaps: Array<{ from: string; to: string; days: number }>
  }
  symptomsTimeline: {
    onset: string | null
    progression: Array<{ date: string | null; description: string }>
    current_status: string | null
    pain_levels: Array<{ date: string | null; level: number; context: string | null }>
  }
  suggestedDiagnoses: Array<{
    diagnosis: string
    icd10_code: string | null
    confidence: 'high' | 'medium' | 'low'
    supporting_evidence: string | null
  }>
  extractionNotes: string | null

  // Provider
  providerName?: string
  providerCredentials?: string
  providerNpi?: string
  providerSignatureBase64?: string
}

const styles = StyleSheet.create({
  page: { padding: 50, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.5 },
  clinicHeader: { textAlign: 'center', alignItems: 'center', marginBottom: 10 },
  clinicDetail: { fontSize: 9, color: '#444' },
  separator: { borderBottomWidth: 1, borderBottomColor: '#ccc', borderBottomStyle: 'solid', marginTop: 10, marginBottom: 10 },
  documentTitle: { fontFamily: 'Helvetica-Bold', fontSize: 14, textAlign: 'center', marginBottom: 8 },
  metaRow: { flexDirection: 'row', justifyContent: 'center', fontSize: 9, color: '#666', marginBottom: 4 },
  metaBadge: { marginHorizontal: 6 },
  patientInfoRow: { flexDirection: 'row', marginBottom: 2 },
  patientLabel: { fontFamily: 'Helvetica-Bold', marginRight: 4 },
  patientValue: { flex: 1 },
  sectionHeading: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 14, marginBottom: 4 },
  sectionBody: { fontSize: 10, lineHeight: 1.6 },
  subHeading: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginTop: 6, marginBottom: 2 },
  findingBlock: { borderWidth: 1, borderColor: '#e5e5e5', borderStyle: 'solid', padding: 6, marginBottom: 6, borderRadius: 2 },
  findingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 },
  findingRegion: { fontFamily: 'Helvetica-Bold', fontSize: 10, flex: 1, paddingRight: 8 },
  severityBadge: { fontSize: 8, paddingHorizontal: 4, paddingVertical: 1, width: 60, textAlign: 'center' },
  bulletRow: { flexDirection: 'row', marginLeft: 8, marginTop: 1 },
  bullet: { width: 10 },
  bulletContent: { flex: 1 },
  dxRow: { borderWidth: 1, borderColor: '#e5e5e5', borderStyle: 'solid', padding: 6, marginBottom: 4, borderRadius: 2 },
  dxHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 },
  dxMain: { flex: 1, paddingRight: 8 },
  dxName: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  dxIcd: { fontSize: 9, color: '#666', marginLeft: 4 },
  dxEvidence: { fontSize: 9, color: '#666', marginTop: 2 },
  confidenceBadge: { fontSize: 8, paddingHorizontal: 4, paddingVertical: 1, width: 50, textAlign: 'center' },
  gapWarning: { fontSize: 9, color: '#b45309', marginTop: 2 },
  muted: { color: '#666' },
  timelineRow: { flexDirection: 'row', marginTop: 2 },
  timelineDate: { fontSize: 9, color: '#666', width: 80 },
  timelineText: { flex: 1, fontSize: 10 },
  painBadge: { fontSize: 9, marginRight: 6, marginBottom: 2, borderWidth: 1, borderColor: '#ccc', borderStyle: 'solid', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 },
  signatureBlock: { marginTop: 24 },
  signatureImage: { height: 40, width: 120, marginBottom: 4 },
  providerName: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  providerDetail: { fontSize: 9, color: '#666' },
  disclaimer: { fontSize: 8, color: '#666', marginTop: 20, fontStyle: 'italic' },
  logo: { height: 80, marginBottom: 6 },
  notesBlock: { backgroundColor: '#f5f5f5', padding: 8, marginTop: 12, borderRadius: 2 },
})

const severityStyleMap: Record<string, { color: string; backgroundColor: string }> = {
  mild: { color: '#854d0e', backgroundColor: '#fef9c3' },
  moderate: { color: '#9a3412', backgroundColor: '#ffedd5' },
  severe: { color: '#991b1b', backgroundColor: '#fee2e2' },
}

const confidenceStyleMap: Record<string, { color: string; backgroundColor: string; borderColor: string }> = {
  high: { color: '#15803d', backgroundColor: '#f0fdf4', borderColor: '#22c55e' },
  medium: { color: '#a16207', backgroundColor: '#fefce8', borderColor: '#eab308' },
  low: { color: '#b91c1c', backgroundColor: '#fef2f2', borderColor: '#ef4444' },
}

const reviewStatusLabel: Record<string, string> = {
  approved: 'Approved',
  edited: 'Approved with edits',
  pending_review: 'Pending review',
  rejected: 'Rejected',
}

export function CaseSummaryPdf({ data }: { data: CaseSummaryPdfData }) {
  const hasImaging = data.imagingFindings.length > 0
  const hasPriorTreatmentData =
    data.priorTreatment.modalities.length > 0 ||
    data.priorTreatment.total_visits != null ||
    data.priorTreatment.treatment_period != null ||
    data.priorTreatment.gaps.length > 0
  const hasTimelineData =
    data.symptomsTimeline.onset != null ||
    data.symptomsTimeline.current_status != null ||
    data.symptomsTimeline.progression.length > 0 ||
    data.symptomsTimeline.pain_levels.length > 0
  const hasDiagnoses = data.suggestedDiagnoses.length > 0

  const disclaimerText = `AI-generated clinical summary synthesized from approved case extractions. Review status: ${reviewStatusLabel[data.reviewStatus] ?? data.reviewStatus}${data.reviewedAt ? ` on ${data.reviewedAt}` : ''}${data.providerName ? ` by ${data.providerName}` : ''}.`

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Clinic Header */}
        <View style={styles.clinicHeader}>
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

        <Text style={styles.documentTitle}>Clinical Case Summary</Text>

        <View style={styles.metaRow}>
          <Text>
            Generated: {data.generatedAt}  •  Status: {reviewStatusLabel[data.reviewStatus] ?? data.reviewStatus}
            {data.aiConfidence ? `  •  Confidence: ${data.aiConfidence}` : ''}
          </Text>
        </View>

        <View style={styles.separator} />

        {/* Patient Info Block */}
        <View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Patient:</Text><Text style={styles.patientValue}>{data.patientName}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>DOB:</Text><Text style={styles.patientValue}>{data.dob}</Text></View>
          <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Date of Injury:</Text><Text style={styles.patientValue}>{data.dateOfInjury}</Text></View>
          {data.accidentType && (
            <View style={styles.patientInfoRow}><Text style={styles.patientLabel}>Accident Type:</Text><Text style={styles.patientValue}>{data.accidentType}</Text></View>
          )}
        </View>

        {/* Chief Complaint */}
        <Text style={styles.sectionHeading} minPresenceAhead={40}>Chief Complaint</Text>
        <Text style={styles.sectionBody}>
          {data.chiefComplaint || '—'}
        </Text>

        {/* Imaging Findings */}
        <Text style={styles.sectionHeading} minPresenceAhead={40}>Imaging Findings</Text>
        {!hasImaging ? (
          <Text style={[styles.sectionBody, styles.muted]}>No imaging findings recorded.</Text>
        ) : (
          <View>
            {data.imagingFindings.map((f, i) => {
              const sevStyle = f.severity ? severityStyleMap[f.severity] : null
              return (
                <View key={i} style={styles.findingBlock}>
                  <View style={styles.findingHeader}>
                    <Text style={styles.findingRegion}>{f.body_region}</Text>
                    {f.severity && sevStyle && (
                      <Text style={[styles.severityBadge, sevStyle]}>{f.severity.toUpperCase()}</Text>
                    )}
                  </View>
                  {f.summary && <Text style={[styles.sectionBody, styles.muted]}>{f.summary}</Text>}
                  {f.key_findings.length > 0 && (
                    <View style={{ marginTop: 2 }}>
                      {f.key_findings.map((kf, j) => (
                        <View key={j} style={styles.bulletRow}>
                          <Text style={styles.bullet}>{'•'}</Text>
                          <Text style={styles.bulletContent}>{kf}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        )}

        {/* Prior Treatment */}
        <Text style={styles.sectionHeading} minPresenceAhead={40}>Prior Treatment</Text>
        {!hasPriorTreatmentData ? (
          <Text style={[styles.sectionBody, styles.muted]}>No prior treatment recorded.</Text>
        ) : (
          <View>
            {data.priorTreatment.modalities.length > 0 && (
              <View style={styles.patientInfoRow}>
                <Text style={styles.patientLabel}>Modalities:</Text>
                <Text style={styles.patientValue}>{data.priorTreatment.modalities.join(', ')}</Text>
              </View>
            )}
            {data.priorTreatment.total_visits != null && (
              <View style={styles.patientInfoRow}>
                <Text style={styles.patientLabel}>Total Visits:</Text>
                <Text style={styles.patientValue}>{String(data.priorTreatment.total_visits)}</Text>
              </View>
            )}
            {data.priorTreatment.treatment_period && (
              <View style={styles.patientInfoRow}>
                <Text style={styles.patientLabel}>Period:</Text>
                <Text style={styles.patientValue}>{data.priorTreatment.treatment_period}</Text>
              </View>
            )}
            {data.priorTreatment.gaps.length > 0 && (
              <View style={{ marginTop: 4 }}>
                <Text style={[styles.subHeading, { color: '#b45309' }]}>Treatment Gaps</Text>
                {data.priorTreatment.gaps.map((g, i) => (
                  <Text key={i} style={styles.gapWarning}>
                    {g.from} to {g.to} ({g.days} days)
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Symptoms Timeline */}
        <Text style={styles.sectionHeading} minPresenceAhead={40}>Symptoms Timeline</Text>
        {!hasTimelineData ? (
          <Text style={[styles.sectionBody, styles.muted]}>No symptom timeline recorded.</Text>
        ) : (
          <View>
            {data.symptomsTimeline.onset && (
              <View style={styles.patientInfoRow}>
                <Text style={styles.patientLabel}>Onset:</Text>
                <Text style={styles.patientValue}>{data.symptomsTimeline.onset}</Text>
              </View>
            )}
            {data.symptomsTimeline.progression.length > 0 && (
              <View style={{ marginTop: 4 }}>
                <Text style={styles.subHeading}>Progression</Text>
                {data.symptomsTimeline.progression.map((p, i) => (
                  <View key={i} style={styles.timelineRow} wrap={false}>
                    <Text style={styles.timelineDate}>{p.date || '—'}</Text>
                    <Text style={styles.timelineText}>{p.description}</Text>
                  </View>
                ))}
              </View>
            )}
            {data.symptomsTimeline.current_status && (
              <View style={[styles.patientInfoRow, { marginTop: 4 }]}>
                <Text style={styles.patientLabel}>Current Status:</Text>
                <Text style={styles.patientValue}>{data.symptomsTimeline.current_status}</Text>
              </View>
            )}
            {data.symptomsTimeline.pain_levels.length > 0 && (
              <View style={{ marginTop: 4 }}>
                <Text style={styles.subHeading}>Pain Levels</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {data.symptomsTimeline.pain_levels.map((pl, i) => (
                    <Text key={i} style={styles.painBadge}>
                      {pl.date ? `${pl.date}: ` : ''}{pl.level}/10{pl.context ? ` (${pl.context})` : ''}
                    </Text>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {/* Suggested Diagnoses */}
        <Text style={styles.sectionHeading} minPresenceAhead={40}>Suggested Diagnoses</Text>
        {!hasDiagnoses ? (
          <Text style={[styles.sectionBody, styles.muted]}>No diagnoses suggested.</Text>
        ) : (
          <View>
            {data.suggestedDiagnoses.map((dx, i) => {
              const confStyle = confidenceStyleMap[dx.confidence]
              return (
                <View key={i} style={styles.dxRow}>
                  <View style={styles.dxHeader}>
                    <View style={styles.dxMain}>
                      <Text>
                        <Text style={styles.dxName}>{dx.diagnosis}</Text>
                        {dx.icd10_code && <Text style={styles.dxIcd}>  {dx.icd10_code}</Text>}
                      </Text>
                    </View>
                    {confStyle && (
                      <Text style={[styles.confidenceBadge, { color: confStyle.color, backgroundColor: confStyle.backgroundColor, borderWidth: 1, borderColor: confStyle.borderColor, borderStyle: 'solid', borderRadius: 2 }]}>
                        {dx.confidence}
                      </Text>
                    )}
                  </View>
                  {dx.supporting_evidence && (
                    <Text style={styles.dxEvidence}>{dx.supporting_evidence}</Text>
                  )}
                </View>
              )
            })}
          </View>
        )}

        {/* Extraction Notes */}
        {data.extractionNotes && (
          <View style={styles.notesBlock} wrap={false}>
            <Text style={styles.subHeading}>Notes</Text>
            <Text style={styles.sectionBody}>{data.extractionNotes}</Text>
          </View>
        )}

        <View style={styles.separator} />

        {/* Signature Block */}
        <View style={styles.signatureBlock} wrap={false}>
          {data.providerSignatureBase64 && <Image src={data.providerSignatureBase64} style={styles.signatureImage} />}
          {data.providerName && (
            <Text style={styles.providerName}>
              {data.providerName}{data.providerCredentials && `, ${data.providerCredentials}`}
            </Text>
          )}
          {data.providerNpi && <Text style={styles.providerDetail}>NPI: {data.providerNpi}</Text>}
        </View>

        <Text style={styles.disclaimer} wrap={false}>{disclaimerText}</Text>
      </Page>
    </Document>
  )
}
