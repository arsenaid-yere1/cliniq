'use client'

import { useCallback, useMemo, useState } from 'react'
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

const docTypeOptions = [
  { value: 'all', label: 'All Types' },
  { value: 'mri_report', label: 'MRI Report' },
  { value: 'chiro_report', label: 'Chiro Report' },
  { value: 'pain_management', label: 'Pain Management' },
  { value: 'pt_report', label: 'PT Report' },
  { value: 'orthopedic_report', label: 'Orthopedic Report' },
  { value: 'ct_scan', label: 'CT Scan Report' },
  { value: 'generated', label: 'Generated' },
]

const statusOptions = [
  { value: 'all', label: 'All Statuses' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'pending_review', label: 'Pending Review' },
]

interface Document {
  id: string
  case_id: string
  file_name: string
  file_path: string
  mime_type: string | null
  document_type: string
  status: string
  created_at: string
  notes: string | null
  uploaded_by: { full_name: string } | null
}

interface DocumentListProps {
  documents: Document[]
  caseId: string
}

export function DocumentList({ documents: initialDocuments, caseId }: DocumentListProps) {
  const [documents, setDocuments] = useState(initialDocuments)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [docType, setDocType] = useState('all')
  const [status, setStatus] = useState('all')
  const caseStatus = useCaseStatus()
  const isClosed = caseStatus === 'closed'

  const refreshDocuments = useCallback(async () => {
    const { data } = await listDocuments(caseId)
    if (data) setDocuments(data)
  }, [caseId])

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
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setUploadOpen(true)} disabled={isClosed}>
          <Upload className="h-4 w-4 mr-2" />
          Upload Document
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger className="w-[180px]">
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
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Active filters:</span>
          {activeFilters.map((f) => (
            <Badge key={f.key} variant="secondary" className="gap-1">
              {f.label}
              <button
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
            <DocumentCard key={doc.id} document={doc} onRemoved={refreshDocuments} />
          ))}
        </div>
      )}

      <UploadSheet caseId={caseId} open={uploadOpen} onOpenChange={setUploadOpen} onUploadComplete={refreshDocuments} />
    </div>
  )
}
