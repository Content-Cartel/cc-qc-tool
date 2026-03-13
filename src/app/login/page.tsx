'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import type { UserRole } from '@/lib/supabase/types'

export default function LoginPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [role, setRole] = useState<UserRole>('editor')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const validPasswords: Record<string, UserRole[]> = {
      'ccqc2024': ['editor', 'pm', 'admin'],
      'ccpm2024': ['pm', 'admin'],
    }

    let authenticated = false
    for (const [pwd, roles] of Object.entries(validPasswords)) {
      if (password === pwd && roles.includes(role)) {
        authenticated = true
        break
      }
    }

    if (!authenticated) {
      setError('Invalid password or role')
      setLoading(false)
      return
    }

    if (!name.trim()) {
      setError('Please enter your name')
      setLoading(false)
      return
    }

    localStorage.setItem('qc_user', name.trim())
    localStorage.setItem('qc_role', role)
    localStorage.setItem('qc_auth', 'true')

    if (role === 'pm' || role === 'admin') {
      router.push('/dashboard')
    } else {
      router.push('/submit')
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
              <label className="label">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder="Your name"
                required
              />
            </div>

            <div>
              <label className="label">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="input"
              >
                <option value="editor">Editor</option>
                <option value="pm">Production Manager</option>
              </select>
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
