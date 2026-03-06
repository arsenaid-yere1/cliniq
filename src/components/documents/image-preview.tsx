'use client'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface ImagePreviewProps {
  url: string
  fileName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImagePreview({ url, fileName, open, onOpenChange }: ImagePreviewProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate">{fileName}</DialogTitle>
        </DialogHeader>
        {/* Using <img> since URL is a signed Supabase URL */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={fileName} className="w-full h-auto rounded" />
      </DialogContent>
    </Dialog>
  )
}
