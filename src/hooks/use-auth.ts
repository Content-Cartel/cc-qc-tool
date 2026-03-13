'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface AuthState {
  user: string | null
  role: 'editor' | 'pm' | 'admin' | null
  isAuthenticated: boolean
  isPM: boolean
  isEditor: boolean
  isAdmin: boolean
  logout: () => void
}

export function useAuth(requireAuth = true): AuthState {
  const router = useRouter()
  const [user, setUser] = useState<string | null>(null)
  const [role, setRole] = useState<'editor' | 'pm' | 'admin' | null>(null)

  useEffect(() => {
    const storedUser = localStorage.getItem('qc_user')
    const storedRole = localStorage.getItem('qc_role') as 'editor' | 'pm' | 'admin' | null
    const storedAuth = localStorage.getItem('qc_auth')

    if (storedUser && storedRole && storedAuth) {
      setUser(storedUser)
      setRole(storedRole)
    } else if (requireAuth) {
      router.push('/login')
    }
  }, [requireAuth, router])

  const logout = useCallback(() => {
    localStorage.removeItem('qc_user')
    localStorage.removeItem('qc_role')
    localStorage.removeItem('qc_auth')
    router.push('/login')
  }, [router])

  return {
    user,
    role,
    isAuthenticated: !!user && !!role,
    isPM: role === 'pm' || role === 'admin',
    isEditor: role === 'editor',
    isAdmin: role === 'admin',
    logout,
  }
}
