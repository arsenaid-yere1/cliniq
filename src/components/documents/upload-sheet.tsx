'use client'

import { useState, useCallback, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { toast } from 'sonner'
import { createBrowserClient } from '@supabase/ssr'
import { Upload, X, FileIcon } from 'lucide-react'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { createTusUpload } from '@/lib/tus-upload'
import { getUploadSession, saveDocumentMetadata, reconcileDocumentUpload } from '@/actions/documents'
import { extractMriReport } from '@/actions/mri-extractions'
import { extractChiroReport } from '@/actions/chiro-extractions'
import { extractPainManagementReport } from '@/actions/pain-management-extractions'
import { extractPtReport } from '@/actions/pt-extractions'
import { extractOrthopedicReport } from '@/actions/orthopedic-extractions'
import { extractCtScanReport } from '@/actions/ct-scan-extractions'
import { extractXRayReport } from '@/actions/x-ray-extractions'
import {
  ALLOWED_MIME_TYPES, MAX_FILE_SIZE, type DocumentType,
} from '@/lib/validations/document'

import { transitionUpload, type UploadEntry } from '@/lib/documents/upload-state'

interface UploadSheetProps {
  caseId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploadComplete?: () => void | Promise<void>
  isAdmin?: boolean
}

const extractors: Partial<Record<DocumentType, (id: string) => Promise<{ error?: string | null }>>> = {
  mri_report: extractMriReport, chiro_report: extractChiroReport,
  pain_management: extractPainManagementReport, pt_report: extractPtReport,
  orthopedic_report: extractOrthopedicReport, ct_scan: extractCtScanReport, x_ray: extractXRayReport,
}

export function UploadSheet(props: UploadSheetProps) {
  return props.open ? <UploadSession key={props.caseId} {...props} /> : null
}

function UploadSession({ caseId, open, onOpenChange, onUploadComplete, isAdmin = false }: UploadSheetProps) {
  const [files, setFiles] = useState<UploadEntry[]>([])
  const queue = useRef<UploadEntry[]>([])
  const batchBusy = useRef(false)
  const inFlight = useRef(new Set<string>())
  const dispatched = useRef(new Set<string>())
  const [isUploading, setIsUploading] = useState(false)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (batchBusy.current) return
    const added: UploadEntry[] = acceptedFiles.map((file) => ({
      uploadId: crypto.randomUUID(), file, documentType: 'mri_report', progress: 0, phase: 'staged',
    }))
    queue.current = [...queue.current, ...added]
    setFiles(queue.current)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled: isUploading,
    accept: {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxSize: MAX_FILE_SIZE,
    onDropRejected: (rejections) => {
      rejections.forEach((r) => {
        const msg = r.errors.map((e) => e.message).join(', ')
        toast.error(`${r.file.name}: ${msg}`)
      })
    },
  })

  function changeEntry(next: UploadEntry) {
    queue.current = queue.current.map((entry) => entry.uploadId === next.uploadId ? transitionUpload(entry, next) : entry)
    setFiles(queue.current)
  }

  function removeFile(id: string) {
    if (batchBusy.current) return
    queue.current = queue.current.filter((entry) => entry.uploadId !== id || entry.phase === 'uploaded')
    setFiles(queue.current)
  }

  function setDocumentType(id: string, documentType: DocumentType) {
    if (batchBusy.current) return
    queue.current = queue.current.map((entry) => entry.uploadId === id && entry.phase === 'staged' ? { ...entry, documentType } : entry)
    setFiles(queue.current)
  }

  async function refreshDocuments() {
    try { await onUploadComplete?.() } catch { toast.error('Unable to refresh documents. Refresh status to check again.') }
  }

  async function dispatchExtraction(documentId: string, documentType: DocumentType) {
    const extractor = extractors[documentType]
    if (!extractor || dispatched.current.has(documentId)) return
    dispatched.current.add(documentId)
    try {
      const result = await extractor(documentId)
      if (result.error) toast.error('Extraction needs attention. Check the document status.')
    } catch {
      toast.error('Extraction was not confirmed. Check the document status.')
    } finally {
      await refreshDocuments()
    }
  }

  async function uploadOne(entry: UploadEntry) {
    if (inFlight.current.has(entry.uploadId)) return
    if (!['staged', 'transfer_failed', 'registration_failed'].includes(entry.phase)) return
    inFlight.current.add(entry.uploadId)
    const descriptor = { uploadId: entry.uploadId, file: entry.file, documentType: entry.documentType }
    const input = {
      caseId, uploadId: entry.uploadId, documentType: entry.documentType,
      fileName: entry.file.name, fileSize: entry.file.size,
      mimeType: entry.file.type as typeof ALLOWED_MIME_TYPES[number],
    }
    let storagePath = 'storagePath' in entry ? entry.storagePath : undefined
    let registering = entry.phase === 'registration_failed'
    try {
      if (!registering) {
        changeEntry({ ...descriptor, phase: 'preparing', progress: entry.progress, storagePath })
        const sessionResult = await getUploadSession(input, { allowLocked: isAdmin })
        if (sessionResult.error || !sessionResult.data) throw new Error(sessionResult.error || 'Unable to prepare upload')
        if (storagePath && storagePath !== sessionResult.data.storagePath) throw new Error('Upload identity conflict')
        storagePath = sessionResult.data.storagePath
        let alreadyTransferred = false
        if (entry.phase === 'transfer_failed') {
          const reconciled = await reconcileDocumentUpload({ ...input, filePath: storagePath }, { allowLocked: isAdmin })
          if (reconciled.error || !reconciled.data) throw new Error(reconciled.error || 'Transfer not confirmed')
          alreadyTransferred = reconciled.data.state === 'present'
        }
        if (!alreadyTransferred) {
          const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) throw new Error('Not authenticated. Sign in and retry this upload.')
          const path = storagePath
          changeEntry({ ...descriptor, phase: 'uploading', progress: 0, storagePath: path })
          await new Promise<void>((resolve, reject) => {
            createTusUpload({
              file: entry.file, storagePath: path, accessToken: session.access_token,
              onProgress: (progress) => {
                if (queue.current.find((row) => row.uploadId === entry.uploadId)?.phase === 'uploading') {
                  changeEntry({ ...descriptor, phase: 'uploading', progress, storagePath: path })
                }
              },
              onSuccess: resolve, onError: reject,
            }).start()
          })
        }
      }
      if (!storagePath) throw new Error('Upload path is unavailable')
      registering = true
      changeEntry({ ...descriptor, phase: 'registering', progress: 100, storagePath })
      const result = await saveDocumentMetadata({ ...input, filePath: storagePath, fileSizeBytes: input.fileSize }, { allowLocked: isAdmin })
      if (result.error || !result.data) throw new Error(result.error || 'Document registration was not confirmed')
      changeEntry({ ...descriptor, phase: 'uploaded', progress: 100, storagePath, documentId: result.data.id })
      await refreshDocuments()
      // A replay may already have dispatched extraction. Never replace its findings automatically.
      if (result.data.created) void dispatchExtraction(result.data.id, entry.documentType)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The request was not confirmed. Retry to check again.'
      if (registering && storagePath) {
        changeEntry({ ...descriptor, phase: 'registration_failed', progress: 100, storagePath, error: message })
      } else {
        changeEntry({ ...descriptor, phase: 'transfer_failed', progress: entry.progress, storagePath, error: message })
      }
    } finally {
      inFlight.current.delete(entry.uploadId)
    }
  }

  async function handleUploadAll(id?: string) {
    if (batchBusy.current) return
    const entries = queue.current.filter((entry) => id ? entry.uploadId === id : entry.phase === 'staged')
    if (!entries.length) return
    batchBusy.current = true
    setIsUploading(true)
    try { for (const entry of entries) await uploadOne(entry) }
    finally { batchBusy.current = false; setIsUploading(false) }
  }

  function handleClose(nextOpen: boolean) {
    if (batchBusy.current) return
    onOpenChange(nextOpen)
  }

  const stagedCount = files.filter((entry) => entry.phase === 'staged').length

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent showCloseButton={!isUploading} className="w-full max-w-[480px] sm:max-w-[480px] flex flex-col px-4 pb-4">
        <SheetHeader>
          <SheetTitle>Upload Documents</SheetTitle>
          <SheetDescription>
            Upload PDF, DOCX, or image files (max 50MB each). Closing clears the unfinished local queue. Uploaded documents remain in Documents.
          </SheetDescription>
        </SheetHeader>

        <div
          {...getRootProps()}
          className={cn(
            'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
            isDragActive
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50',
          )}
        >
          <input {...getInputProps()} aria-label="Choose documents to upload" />
          <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            {isDragActive
              ? 'Drop files here...'
              : 'Drag & drop files, or click to browse'}
          </p>
        </div>

        {files.length > 0 && (
          <div className="flex-1 overflow-y-auto space-y-3 mt-4">
            {files.map((f) => (
              <div key={f.uploadId} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm truncate" title={f.file.name}>{f.file.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {(f.file.size / 1024 / 1024).toFixed(1)}MB
                    </span>
                  </div>
                  {['staged', 'transfer_failed', 'registration_failed'].includes(f.phase) && (
                    <Button disabled={isUploading} aria-label={`Remove ${f.file.name} from queue`} variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => removeFile(f.uploadId)}>
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>

                {f.phase === 'staged' && (
                  <Select disabled={isUploading} value={f.documentType}
                    onValueChange={(v) => setDocumentType(f.uploadId, v as DocumentType)}>
                    <SelectTrigger aria-label={`Document type for ${f.file.name}`} className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mri_report">MRI Report</SelectItem>
                      <SelectItem value="chiro_report">Chiropractor Report</SelectItem>
                      <SelectItem value="pain_management">Pain Management Report</SelectItem>
                      <SelectItem value="pt_report">PT Report</SelectItem>
                      <SelectItem value="orthopedic_report">Orthopedic Report</SelectItem>
                      <SelectItem value="ct_scan">CT Scan Report</SelectItem>
                      <SelectItem value="x_ray">X-Ray Report</SelectItem>
                      <SelectItem value="lien_agreement">Lien Agreement (Signed)</SelectItem>
                      <SelectItem value="procedure_consent">Procedure Consent (Signed)</SelectItem>
                      {isAdmin && (
                        <>
                          <SelectItem value="initial_visit">Initial Visit (Historical)</SelectItem>
                          <SelectItem value="procedure">Procedure (Historical)</SelectItem>
                          <SelectItem value="discharge">Discharge (Historical)</SelectItem>
                          <SelectItem value="invoice">Invoice (Historical)</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                )}

                {(f.phase === 'uploading' || f.phase === 'uploaded') && (
                  <Progress value={f.progress} className="h-2" />
                )}

                <p className="text-sm" role="status">{{
                  staged: 'Ready to upload', preparing: 'Preparing upload…', uploading: 'Transferring file…',
                  registering: 'Saving document…', uploaded: 'Uploaded — check Documents for extraction status',
                  transfer_failed: 'File transfer not confirmed', registration_failed: 'File transferred — document not saved yet',
                }[f.phase]}</p>
                {(f.phase === 'transfer_failed' || f.phase === 'registration_failed') && (
                  <div className="space-y-2">
                    <p role="alert" className="text-sm text-destructive break-words">{f.error}</p>
                    <Button variant="outline" size="sm" disabled={isUploading} onClick={() => handleUploadAll(f.uploadId)}>
                      {f.phase === 'registration_failed' ? 'Retry saving document' : 'Retry upload'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {stagedCount > 0 && (
          <Button onClick={() => handleUploadAll()} disabled={isUploading} className="mt-4">
            {isUploading ? 'Uploading...' : `Upload ${stagedCount} file(s)`}
          </Button>
        )}
      </SheetContent>
    </Sheet>
  )
}
