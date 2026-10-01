'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PROCESSING_WINDOW_MS, type ExtractionSummary } from '@/lib/documents/extraction-summary'
import { useDebouncedCallback } from 'use-debounce'
import { Search, X, Upload } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DocumentCard } from '@/components/documents/document-card'
import { UploadSheet } from '@/components/documents/upload-sheet'
import { listDocuments } from '@/actions/documents'
import { useCaseStatus } from '@/components/patients/case-status-context'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'

const docTypeOptions = [
  { value: 'all', label: 'All Types' },
  { value: 'mri_report', label: 'MRI Report' },
  { value: 'chiro_report', label: 'Chiro Report' },
  { value: 'pain_management', label: 'Pain Management' },
  { value: 'pt_report', label: 'PT Report' },
  { value: 'orthopedic_report', label: 'Orthopedic Report' },
  { value: 'ct_scan', label: 'CT Scan Report' },
  { value: 'x_ray', label: 'X-Ray Report' },
  { value: 'generated', label: 'Generated' },
  { value: 'initial_visit', label: 'Initial Visit' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'discharge', label: 'Discharge' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'lien_agreement', label: 'Lien Agreement' },
  { value: 'procedure_consent', label: 'Procedure Consent' },
  { value: 'other', label: 'Other' },
]

const statusOptions = [
  { value: 'all', label: 'All Statuses' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'pending_review', label: 'Pending Review' },
]

interface Document {
  extraction_summary?: ExtractionSummary
  id: string
  case_id: string
  file_name: string
  file_path: string
  mime_type: string | null
  document_type: string
  status: string
  created_at: string
  content_date: string | null
  procedure_number: number | null
  revision_status: 'superseded_discharge' | 'current_corrected_discharge' | 'reset_pending' | 'superseded_note' | null
  revision_history?: string | null
  revision_number: number | null
  notes: string | null
  uploaded_by: { full_name: string } | null
}

interface DocumentListProps {
  documents: Document[]
  caseId: string
  patientLastName: string | null
  isAdmin?: boolean
  initialError?: string
}

export function DocumentList(props: DocumentListProps) {
  return <DocumentListSession key={props.caseId} {...props} />
}

function DocumentListSession({ documents: initialDocuments, caseId, patientLastName, isAdmin = false, initialError }: DocumentListProps) {
  const [documents, setDocuments] = useState(initialDocuments)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [docType, setDocType] = useState('all')
  const [status, setStatus] = useState('all')
  const caseStatus = useCaseStatus()
  const isLocked = LOCKED_STATUSES.includes(caseStatus as CaseStatus)
  // Admins can upload to a locked case (the server re-checks the role).
  const uploadDisabled = isLocked && !isAdmin

  const [loadError, setLoadError] = useState(initialError ?? '')
  const [refreshing, setRefreshing] = useState(false)
  const fetching = useRef(false)
  const generation = useRef(0)
  const deadline = useRef(Date.now() + PROCESSING_WINDOW_MS)
  useEffect(() => () => { generation.current++ }, [])

  const refreshDocuments = useCallback(async (restart = true) => {
    if (restart) deadline.current = Date.now() + PROCESSING_WINDOW_MS
    if (fetching.current) return
    fetching.current = true
    const currentGeneration = generation.current
    setRefreshing(true)
    try {
      const result = await listDocuments(caseId)
      if (generation.current !== currentGeneration) return
      if (result.error) setLoadError('Unable to refresh documents. Previously loaded documents are still shown.')
      else { setDocuments(result.data); setLoadError('') }
    } catch {
      if (generation.current === currentGeneration) setLoadError('Unable to refresh documents. Previously loaded documents are still shown.')
    } finally {
      fetching.current = false
      if (generation.current === currentGeneration) setRefreshing(false)
    }
  }, [caseId])

  const processing = documents.some(doc => doc.extraction_summary?.kind === 'processing')
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState !== 'hidden') void refreshDocuments() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    const timer = processing ? window.setInterval(() => {
      if (document.visibilityState !== 'hidden' && Date.now() < deadline.current) void refreshDocuments(false)
    }, 5000) : undefined
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [processing, refreshDocuments])

  const debouncedSetSearch = useDebouncedCallback((value: string) => {
    setDebouncedSearch(value)
  }, 300)

  function handleSearchChange(value: string) {
    setSearch(value)
    debouncedSetSearch(value)
  }

  const filtered = useMemo(() => {
    return documents.filter((doc) => {
      if (docType !== 'all' && doc.document_type !== docType) return false
      if (status !== 'all' && doc.status !== status) return false
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase()
        if (
          !doc.file_name.toLowerCase().includes(q) &&
          !(doc.notes?.toLowerCase().includes(q))
        ) return false
      }
      return true
    })
  }, [documents, docType, status, debouncedSearch])

  const activeFilters = [
    ...(docType !== 'all' ? [{ key: 'docType', label: docTypeOptions.find(o => o.value === docType)?.label ?? docType }] : []),
    ...(status !== 'all' ? [{ key: 'status', label: statusOptions.find(o => o.value === status)?.label ?? status }] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search documents"
            placeholder="Search documents..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setUploadOpen(true)} disabled={uploadDisabled}>
          <Upload className="h-4 w-4 mr-2" />
          Upload Document
        </Button>
      </div>

      {loadError && <p role="alert" className="text-sm text-destructive">{loadError} <Button variant="link" onClick={() => refreshDocuments()} disabled={refreshing}>Retry loading documents</Button></p>}
      <Button variant="outline" size="sm" onClick={() => refreshDocuments()} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh status'}</Button>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger aria-label="Document type filter" className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {docTypeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {statusOptions.map((opt) => (
          <Button
            key={opt.value}
            variant={status === opt.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatus(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Active filters:</span>
          {activeFilters.map((f) => (
            <Badge key={f.key} variant="secondary" className="gap-1">
              {f.label}
              <button aria-label={`Remove ${f.label} filter`}
                onClick={() => {
                  if (f.key === 'docType') setDocType('all')
                  if (f.key === 'status') setStatus('all')
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Showing {filtered.length} of {documents.length} documents
      </p>

      {filtered.length === 0 ? (
        <p className="text-center py-8 text-muted-foreground">
          {documents.length === 0 ? 'No documents yet.' : 'No documents match your filters.'}
        </p>
      ) : (
        <div className="grid gap-3">
          {filtered.map((doc) => (
            <DocumentCard key={doc.id} document={doc} patientLastName={patientLastName} isLocked={isLocked} onRemoved={refreshDocuments} onRefresh={refreshDocuments} refreshing={refreshing} />
          ))}
        </div>
      )}

      <UploadSheet caseId={caseId} open={uploadOpen} onOpenChange={setUploadOpen} onUploadComplete={refreshDocuments} isAdmin={isAdmin} />
    </div>
  )
}
