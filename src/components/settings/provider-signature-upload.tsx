'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, X, PenLine, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { uploadProviderSignature, removeProviderSignature, getProviderSignatureUrl } from '@/actions/settings'

interface ProviderSignatureUploadProps {
  profileId: string
  initialSignaturePath: string | null
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png']
const MAX_SIZE = 1 * 1024 * 1024 // 1 MB

export function ProviderSignatureUpload({ profileId, initialSignaturePath }: ProviderSignatureUploadProps) {
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [isLoadingPreview, setIsLoadingPreview] = useState(!!initialSignaturePath)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!initialSignaturePath) return
    getProviderSignatureUrl(profileId).then((result) => {
      if (result.url) setSignatureUrl(result.url)
      setIsLoadingPreview(false)
    })
  }, [initialSignaturePath, profileId])

  const handleFileSelect = useCallback(async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error('Invalid file type. Please upload a JPEG or PNG image.')
      return
    }
    if (file.size > MAX_SIZE) {
      toast.error('File too large. Maximum size is 1 MB.')
      return
    }

    setIsUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    const result = await uploadProviderSignature(profileId, formData)

    if (result.error) {
      toast.error(result.error)
      setIsUploading(false)
      return
    }

    const urlResult = await getProviderSignatureUrl(profileId)
    if (urlResult.url) setSignatureUrl(urlResult.url)

    toast.success('Signature uploaded')
    setIsUploading(false)
  }, [profileId])

  const handleRemove = useCallback(async () => {
    setIsRemoving(true)
    const result = await removeProviderSignature(profileId)

    if (result.error) {
      toast.error(result.error)
      setIsRemoving(false)
      return
    }

    setSignatureUrl(null)
    toast.success('Signature removed')
    setIsRemoving(false)
  }, [profileId])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileSelect(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileSelect(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider Signature</CardTitle>
        <CardDescription>
          Upload your signature image. It will appear on finalized documents.
          Accepted formats: JPEG, PNG. Maximum size: 1 MB.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png"
          onChange={handleInputChange}
          className="hidden"
        />

        {isLoadingPreview ? (
          <div className="flex items-center justify-center h-32 rounded-lg border border-dashed">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : signatureUrl ? (
          <div className="space-y-4">
            <div className="flex items-center justify-center rounded-lg border bg-muted/30 p-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={signatureUrl}
                alt="Provider signature"
                className="max-h-32 max-w-full object-contain"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading...</>
                ) : (
                  <><Upload className="mr-2 h-4 w-4" /> Replace</>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={handleRemove}
                disabled={isRemoving}
              >
                {isRemoving ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Removing...</>
                ) : (
                  <><X className="mr-2 h-4 w-4" /> Remove</>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="flex flex-col items-center justify-center h-32 rounded-lg border border-dashed cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            {isUploading ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : (
              <>
                <PenLine className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  Click or drag and drop to upload your signature
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  JPEG or PNG up to 1 MB
                </p>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
