'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { pdfjs } from 'react-pdf'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const Document = dynamic(() => import('react-pdf').then((mod) => mod.Document), { ssr: false })
const Page = dynamic(() => import('react-pdf').then((mod) => mod.Page), { ssr: false })

interface PdfPreviewProps {
  url: string
  fileName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PdfPreview({ url, fileName, open, onOpenChange }: PdfPreviewProps) {
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate">{fileName}</DialogTitle>
        </DialogHeader>
        <Document
          file={url}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        >
          <Page pageNumber={currentPage} width={700} />
        </Document>
        {numPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-2">
            <Button variant="outline" size="icon"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">{currentPage} / {numPages}</span>
            <Button variant="outline" size="icon"
              onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
              disabled={currentPage >= numPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
