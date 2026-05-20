'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/auth/callback?type=recovery`,
    })

    if (resetErr) {
      setError(resetErr.message)
      setLoading(false)
      return
    }
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-sm">
      <h1 className="text-2xl font-bold mb-2">Reset password</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Enter your email to receive a password reset link.
      </p>

      {sent ? (
        <div className="space-y-4">
          <p className="text-sm">
            If an account exists for <span className="font-medium">{email}</span>,
            a reset link has been sent.
          </p>
          <Link href="/login" className="block text-sm text-primary underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
          <Link href="/login" className="block text-sm text-muted-foreground underline">
            Back to sign in
          </Link>
        </form>
      )}
    </div>
  )
}
