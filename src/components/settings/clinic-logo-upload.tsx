'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, X, ImageIcon, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { uploadClinicLogo, removeClinicLogo, getClinicLogoUrl } from '@/actions/settings'

interface ClinicLogoUploadProps {
  initialLogoPath: string | null
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/svg+xml']
const MAX_SIZE = 2 * 1024 * 1024 // 2 MB

export function ClinicLogoUpload({ initialLogoPath }: ClinicLogoUploadProps) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [isLoadingPreview, setIsLoadingPreview] = useState(!!initialLogoPath)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load existing logo on mount
  useEffect(() => {
    if (!initialLogoPath) return
    getClinicLogoUrl().then((result) => {
      if (result.url) setLogoUrl(result.url)
      setIsLoadingPreview(false)
    })
  }, [initialLogoPath])

  const handleFileSelect = useCallback(async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error('Invalid file type. Please upload a JPEG, PNG, or SVG image.')
      return
    }
    if (file.size > MAX_SIZE) {
      toast.error('File too large. Maximum size is 2 MB.')
      return
    }

    setIsUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    const result = await uploadClinicLogo(formData)

    if (result.error) {
      toast.error(result.error)
      setIsUploading(false)
      return
    }

    // Fetch fresh signed URL for preview
    const urlResult = await getClinicLogoUrl()
    if (urlResult.url) setLogoUrl(urlResult.url)

    toast.success('Clinic logo uploaded')
    setIsUploading(false)
  }, [])

  const handleRemove = useCallback(async () => {
    setIsRemoving(true)
    const result = await removeClinicLogo()

    if (result.error) {
      toast.error(result.error)
      setIsRemoving(false)
      return
    }

    setLogoUrl(null)
    toast.success('Clinic logo removed')
    setIsRemoving(false)
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileSelect(file)
    // Reset input so the same file can be re-selected
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
        <CardTitle>Clinic Logo</CardTitle>
        <CardDescription>
          Upload your clinic logo. It will appear on documents and invoices.
          Accepted formats: JPEG, PNG, SVG. Maximum size: 2 MB.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.svg"
          onChange={handleInputChange}
          className="hidden"
        />

        {isLoadingPreview ? (
          <div className="flex items-center justify-center h-48 rounded-lg border border-dashed">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : logoUrl ? (
          /* Preview state */
          <div className="space-y-4">
            <div className="flex items-center justify-center rounded-lg border bg-muted/30 p-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="Clinic logo"
                className="max-h-48 max-w-full object-contain"
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
          /* Upload state */
          <div
            className="flex flex-col items-center justify-center h-48 rounded-lg border border-dashed cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            {isUploading ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : (
              <>
                <ImageIcon className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  Click or drag and drop to upload your logo
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  JPEG, PNG, or SVG up to 2 MB
                </p>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
