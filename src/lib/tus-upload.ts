import * as tus from 'tus-js-client'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const BUCKET_NAME = 'case-documents'

interface TusUploadOptions {
  file: File
  storagePath: string
  accessToken: string
  onProgress?: (percentage: number) => void
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export function createTusUpload(options: TusUploadOptions): tus.Upload {
  const { file, storagePath, accessToken, onProgress, onSuccess, onError } = options

  const upload = new tus.Upload(file, {
    endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
    retryDelays: [0, 1000, 3000, 5000],
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-upsert': 'false',
    },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    metadata: {
      bucketName: BUCKET_NAME,
      objectName: storagePath,
      contentType: file.type,
      cacheControl: '3600',
    },
    chunkSize: 6 * 1024 * 1024, // 6MB chunks (Supabase minimum)
    onProgress: (bytesUploaded, bytesTotal) => {
      const percentage = Math.round((bytesUploaded / bytesTotal) * 100)
      onProgress?.(percentage)
    },
    onSuccess: () => {
      onSuccess?.()
    },
    onError: (error) => {
      onError?.(error)
    },
  })

  return upload
}
