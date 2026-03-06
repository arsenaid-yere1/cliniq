'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getDocumentDownloadUrl, getDocumentPreviewUrl } from '@/actions/documents'
import { PdfPreview } from './pdf-preview'
import { ImagePreview } from './image-preview'

const docTypeLabels: Record<string, string> = {
  mri_report: 'MRI Report',
  chiro_report: 'Chiro Report',
  generated: 'Generated',
  other: 'Other',
}

const docTypeColors: Record<string, string> = {
  mri_report: 'bg-purple-100 text-purple-800 border-purple-200',
  chiro_report: 'bg-blue-100 text-blue-800 border-blue-200',
  generated: 'bg-green-100 text-green-800 border-green-200',
  other: 'bg-gray-100 text-gray-800 border-gray-200',
}

const docStatusColors: Record<string, string> = {
  reviewed: 'bg-green-100 text-green-800 border-green-200',
  pending_review: 'bg-amber-100 text-amber-800 border-amber-200',
}

const docStatusLabels: Record<string, string> = {
  reviewed: 'Reviewed',
  pending_review: 'Pending Review',
}

interface DocumentCardProps {
  document: {
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
}

export function DocumentCard({ document }: DocumentCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')

  const isPdf = document.mime_type === 'application/pdf'
  const isImage = document.mime_type?.startsWith('image/')
  const canPreview = isPdf || isImage

  async function handlePreview() {
    const result = await getDocumentPreviewUrl(document.file_path)
    if ('error' in result) {
      toast.error(result.error)
      return
    }
    setPreviewUrl(result.url!)
    setPreviewOpen(true)
  }

  async function handleDownload() {
    const result = await getDocumentDownloadUrl(document.file_path)
    if ('error' in result) {
      toast.error(result.error)
      return
    }
    window.open(result.url!, '_blank')
  }

  return (
    <>
      <Card>
        <CardContent className="flex items-start gap-4 p-4">
          <div className="rounded-lg bg-muted p-2">
            <FileText className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="font-medium truncate" title={document.file_name}>
              {document.file_name}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className={docTypeColors[document.document_type] ?? ''}>
                {docTypeLabels[document.document_type] ?? document.document_type}
              </Badge>
              <Badge variant="outline" className={docStatusColors[document.status] ?? ''}>
                {docStatusLabels[document.status] ?? document.status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Uploaded {format(new Date(document.created_at), 'MM/dd/yyyy')}
              {document.uploaded_by && ` by ${document.uploaded_by.full_name}`}
            </p>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              disabled={!canPreview}
              onClick={handlePreview}
            >
              Preview
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
            >
              Download
            </Button>
          </div>
        </CardContent>
      </Card>

      {isPdf && (
        <PdfPreview
          url={previewUrl}
          fileName={document.file_name}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      )}
      {isImage && (
        <ImagePreview
          url={previewUrl}
          fileName={document.file_name}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      )}
    </>
  )
}
