'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { FileText, Trash2 } from 'lucide-react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getDocumentDownloadUrl, getDocumentPreviewUrl, removeDocument } from '@/actions/documents'
import dynamic from 'next/dynamic'
const PdfPreview = dynamic(() => import('./pdf-preview').then(mod => ({ default: mod.PdfPreview })), { ssr: false })
import { ImagePreview } from './image-preview'

const docTypeLabels: Record<string, string> = {
  mri_report: 'MRI Report',
  chiro_report: 'Chiro Report',
  pain_management: 'Pain Management',
  generated: 'Generated',
  other: 'Other',
}

const docTypeColors: Record<string, string> = {
  mri_report: 'bg-purple-100 text-purple-800 border-purple-200',
  chiro_report: 'bg-blue-100 text-blue-800 border-blue-200',
  pain_management: 'bg-orange-100 text-orange-800 border-orange-200',
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
  onRemoved?: () => void
}

export function DocumentCard({ document, onRemoved }: DocumentCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [isRemoving, setIsRemoving] = useState(false)

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

  async function handleRemove() {
    setIsRemoving(true)
    const result = await removeDocument(document.id)
    setIsRemoving(false)
    if ('error' in result && result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Document removed')
    onRemoved?.()
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
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove document?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove &quot;{document.file_name}&quot; from this case. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRemove} disabled={isRemoving}>
                    {isRemoving ? 'Removing...' : 'Remove'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
