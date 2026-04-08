'use client'

import { useState, useCallback } from 'react'
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
import { getUploadSession, saveDocumentMetadata } from '@/actions/documents'
import { extractMriReport } from '@/actions/mri-extractions'
import { extractChiroReport } from '@/actions/chiro-extractions'
import { extractPainManagementReport } from '@/actions/pain-management-extractions'
import { extractPtReport } from '@/actions/pt-extractions'
import { extractOrthopedicReport } from '@/actions/orthopedic-extractions'
import { extractCtScanReport } from '@/actions/ct-scan-extractions'
import {
  ALLOWED_MIME_TYPES, MAX_FILE_SIZE, type DocumentType,
} from '@/lib/validations/document'

interface StagedFile {
  id: string
  file: File
  documentType: DocumentType
  progress: number
  status: 'staged' | 'uploading' | 'complete' | 'error'
  error?: string
}

interface UploadSheetProps {
  caseId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploadComplete?: () => void
}

export function UploadSheet({ caseId, open, onOpenChange, onUploadComplete }: UploadSheetProps) {
  const [files, setFiles] = useState<StagedFile[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: StagedFile[] = acceptedFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      documentType: 'mri_report' as DocumentType,
      progress: 0,
      status: 'staged',
    }))
    setFiles((prev) => [...prev, ...newFiles])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
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

  function updateFile(id: string, updates: Partial<StagedFile>) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)))
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  function setDocumentType(id: string, documentType: DocumentType) {
    updateFile(id, { documentType })
  }

  async function handleUploadAll() {
    const staged = files.filter((f) => f.status === 'staged')
    if (staged.length === 0) return

    setIsUploading(true)

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      toast.error('Not authenticated')
      setIsUploading(false)
      return
    }

    let completedCount = 0
    const pendingExtractions: Array<{ type: 'mri' | 'chiro' | 'pain_management' | 'pt_report' | 'orthopedic_report' | 'ct_scan'; documentId: string }> = []

    for (const stagedFile of staged) {
      try {
        updateFile(stagedFile.id, { status: 'uploading', progress: 0 })

        const sessionResult = await getUploadSession({
          caseId,
          fileName: stagedFile.file.name,
          fileSize: stagedFile.file.size,
          mimeType: stagedFile.file.type as typeof ALLOWED_MIME_TYPES[number],
          documentType: stagedFile.documentType,
        })

        if ('error' in sessionResult && sessionResult.error) {
          const errMsg = typeof sessionResult.error === 'string'
            ? sessionResult.error
            : 'Validation failed'
          updateFile(stagedFile.id, { status: 'error', error: errMsg })
          continue
        }

        const { storagePath } = sessionResult.data!

        await new Promise<void>((resolve, reject) => {
          const upload = createTusUpload({
            file: stagedFile.file,
            storagePath,
            accessToken: session.access_token,
            onProgress: (percentage) => {
              updateFile(stagedFile.id, { progress: percentage })
            },
            onSuccess: () => resolve(),
            onError: (error) => reject(error),
          })
          upload.start()
        })

        const metaResult = await saveDocumentMetadata({
          caseId,
          documentType: stagedFile.documentType,
          fileName: stagedFile.file.name,
          filePath: storagePath,
          fileSizeBytes: stagedFile.file.size,
          mimeType: stagedFile.file.type,
        })

        if ('error' in metaResult && metaResult.error) {
          updateFile(stagedFile.id, { status: 'error', error: metaResult.error as string })
          continue
        }

        updateFile(stagedFile.id, { status: 'complete', progress: 100 })
        completedCount++

        // Queue extractions to run after refresh
        if (stagedFile.documentType === 'mri_report' && metaResult.data) {
          pendingExtractions.push({ type: 'mri', documentId: metaResult.data.id })
        }
        if (stagedFile.documentType === 'chiro_report' && metaResult.data) {
          pendingExtractions.push({ type: 'chiro', documentId: metaResult.data.id })
        }
        if (stagedFile.documentType === 'pain_management' && metaResult.data) {
          pendingExtractions.push({ type: 'pain_management', documentId: metaResult.data.id })
        }
        if (stagedFile.documentType === 'pt_report' && metaResult.data) {
          pendingExtractions.push({ type: 'pt_report', documentId: metaResult.data.id })
        }
        if (stagedFile.documentType === 'orthopedic_report' && metaResult.data) {
          pendingExtractions.push({ type: 'orthopedic_report', documentId: metaResult.data.id })
        }
        if (stagedFile.documentType === 'ct_scan' && metaResult.data) {
          pendingExtractions.push({ type: 'ct_scan', documentId: metaResult.data.id })
        }
      } catch (err) {
        updateFile(stagedFile.id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Upload failed',
        })
      }
    }

    setIsUploading(false)

    if (completedCount > 0) {
      toast.success(`${completedCount} document(s) uploaded`)
      onUploadComplete?.()
    }

    // Fire extractions outside React's transition tracking to avoid blocking list refresh
    setTimeout(() => {
      for (const extraction of pendingExtractions) {
        if (extraction.type === 'mri') {
          extractMriReport(extraction.documentId).then((extractResult) => {
            if ('error' in extractResult && extractResult.error) {
              toast.error(`Extraction failed: ${extractResult.error}`)
            } else {
              const count = extractResult.data?.extractionIds?.length ?? 1
              toast.success(
                count > 1
                  ? `${count} MRI regions extracted`
                  : 'MRI findings extracted',
                {
                  action: {
                    label: 'View',
                    onClick: () => { window.location.href = `/patients/${caseId}/clinical` },
                  },
                },
              )
            }
          })
        }
        if (extraction.type === 'chiro') {
          extractChiroReport(extraction.documentId).then((extractResult) => {
            if ('error' in extractResult && extractResult.error) {
              toast.error(`Extraction failed: ${extractResult.error}`)
            } else {
              toast.success('Chiro findings extracted', {
                action: {
                  label: 'View',
                  onClick: () => { window.location.href = `/patients/${caseId}/clinical` },
                },
              })
            }
          })
        }
        if (extraction.type === 'pain_management') {
          extractPainManagementReport(extraction.documentId).then((extractResult) => {
            if ('error' in extractResult && extractResult.error) {
              toast.error(`Extraction failed: ${extractResult.error}`)
            } else {
              toast.success('Pain management findings extracted', {
                action: {
                  label: 'View',
                  onClick: () => { window.location.href = `/patients/${caseId}/clinical` },
                },
              })
            }
          })
        }
        if (extraction.type === 'pt_report') {
          extractPtReport(extraction.documentId).then((extractResult) => {
            if ('error' in extractResult && extractResult.error) {
              toast.error(`Extraction failed: ${extractResult.error}`)
            } else {
              toast.success('Physical therapy findings extracted', {
                action: {
                  label: 'View',
                  onClick: () => { window.location.href = `/patients/${caseId}/clinical` },
                },
              })
            }
          })
        }
        if (extraction.type === 'orthopedic_report') {
          extractOrthopedicReport(extraction.documentId).then((extractResult) => {
            if ('error' in extractResult && extractResult.error) {
              toast.error(`Extraction failed: ${extractResult.error}`)
            } else {
              toast.success('Orthopedic findings extracted', {
                action: {
                  label: 'View',
                  onClick: () => { window.location.href = `/patients/${caseId}/clinical` },
                },
              })
            }
          })
        }
        if (extraction.type === 'ct_scan') {
          extractCtScanReport(extraction.documentId).then((extractResult) => {
            if ('error' in extractResult && extractResult.error) {
              toast.error(`Extraction failed: ${extractResult.error}`)
            } else {
              const count = extractResult.data?.extractionIds?.length ?? 1
              toast.success(
                count > 1
                  ? `${count} CT scan regions extracted`
                  : 'CT scan findings extracted',
                {
                  action: {
                    label: 'View',
                    onClick: () => { window.location.href = `/patients/${caseId}/clinical` },
                  },
                },
              )
            }
          })
        }
      }
    }, 0)
  }

  function handleClose(open: boolean) {
    if (isUploading) return
    if (!open) setFiles([])
    onOpenChange(open)
  }

  const stagedCount = files.filter((f) => f.status === 'staged').length

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="w-[480px] sm:max-w-[480px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Upload Documents</SheetTitle>
          <SheetDescription>
            Upload PDF, DOCX, or image files (max 50MB each)
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
          <input {...getInputProps()} />
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
              <div key={f.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm truncate">{f.file.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {(f.file.size / 1024 / 1024).toFixed(1)}MB
                    </span>
                  </div>
                  {f.status === 'staged' && (
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => removeFile(f.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>

                {f.status === 'staged' && (
                  <Select value={f.documentType}
                    onValueChange={(v) => setDocumentType(f.id, v as DocumentType)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mri_report">MRI Report</SelectItem>
                      <SelectItem value="chiro_report">Chiropractor Report</SelectItem>
                      <SelectItem value="pain_management">Pain Management Report</SelectItem>
                      <SelectItem value="pt_report">PT Report</SelectItem>
                      <SelectItem value="orthopedic_report">Orthopedic Report</SelectItem>
                      <SelectItem value="ct_scan">CT Scan Report</SelectItem>
                      <SelectItem value="lien_agreement">Lien Agreement (Signed)</SelectItem>
                      <SelectItem value="procedure_consent">Procedure Consent (Signed)</SelectItem>
                    </SelectContent>
                  </Select>
                )}

                {(f.status === 'uploading' || f.status === 'complete') && (
                  <Progress value={f.progress} className="h-2" />
                )}

                {f.status === 'error' && (
                  <p className="text-xs text-destructive">{f.error}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {stagedCount > 0 && (
          <Button onClick={handleUploadAll} disabled={isUploading} className="mt-4">
            {isUploading ? 'Uploading...' : `Upload ${stagedCount} file(s)`}
          </Button>
        )}
      </SheetContent>
    </Sheet>
  )
}
