'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (signInError) {
        setError(signInError.message === 'Invalid login credentials'
          ? 'Invalid email or password'
          : signInError.message
        )
        setLoading(false)
        return
      }

      // Fetch profile to determine redirect
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Authentication failed')
        setLoading(false)
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (!profile) {
        setError('Profile not found. Contact an admin.')
        setLoading(false)
        return
      }

      // Check for redirect param
      const params = new URLSearchParams(window.location.search)
      const redirect = params.get('redirect')

      if (redirect) {
        router.push(redirect)
      } else if (profile.role === 'production_manager' || profile.role === 'admin') {
        router.push('/dashboard')
      } else {
        router.push('/tasks')
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        <div className="card p-8" style={{ borderColor: 'var(--border-2)' }}>
          {/* Logo */}
          <div className="text-center mb-8">
            <div
              className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4 text-lg font-black"
              style={{ background: 'var(--gold)', color: '#000' }}
            >
              CC
            </div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>QC Tool</h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Content Cartel Production</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@contentcartel.net"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="label">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="Enter password"
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full text-sm"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  )
}
