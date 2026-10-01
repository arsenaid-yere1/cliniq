'use client'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

export function useVisitSaveFeedback() {
  const [failure, setFailure] = useState<{ message: string; finalization: boolean } | null>(null)
  const phase = useRef<'save' | 'finalize'>('save')
  const start = useCallback(() => { phase.current = 'save'; setFailure(null) }, [])
  const finalizing = useCallback(() => { phase.current = 'finalize' }, [])
  const fail = useCallback((message: string) => {
    setFailure({ message, finalization: phase.current === 'finalize' })
    toast.error(message)
  }, [])
  return { failure, start, finalizing, fail }
}
