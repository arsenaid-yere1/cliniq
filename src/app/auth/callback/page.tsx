'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function CallbackInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState('')

  useEffect(() => {
    const supabase = createClient()

    async function run() {
      const code = params.get('code')
      const queryType = params.get('type')

      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code)
        if (exErr) {
          setError(exErr.message)
          return
        }
      } else if (typeof window !== 'undefined' && window.location.hash) {
        const hash = new URLSearchParams(window.location.hash.slice(1))
        const access_token = hash.get('access_token')
        const refresh_token = hash.get('refresh_token')
        if (access_token && refresh_token) {
          const { error: setErr } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          })
          if (setErr) {
            setError(setErr.message)
            return
          }
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setError('Could not establish session')
        return
      }

      const hashType =
        typeof window !== 'undefined' && window.location.hash
          ? new URLSearchParams(window.location.hash.slice(1)).get('type')
          : null
      const t = queryType ?? hashType
      if (t === 'recovery' || t === 'invite') {
        router.replace('/reset-password')
        router.refresh()
        return
      }

      router.replace('/patients')
      router.refresh()
    }

    run()
  }, [params, router])

  return error ? (
    <>
      <p className="text-sm text-destructive mb-4">{error}</p>
      <a href="/login" className="text-sm text-primary underline">
        Back to sign in
      </a>
    </>
  ) : (
    <p className="text-sm text-muted-foreground">Signing you in…</p>
  )
}

export default function AuthCallbackPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 text-center shadow-sm">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Signing you in…</p>}>
          <CallbackInner />
        </Suspense>
      </div>
    </main>
  )
}
