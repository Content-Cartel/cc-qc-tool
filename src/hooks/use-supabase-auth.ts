'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

export type AppRole = 'editor' | 'production_manager' | 'admin'

export interface Profile {
  id: string
  display_name: string
  email: string | null
  role: AppRole
  slack_user_id: string | null
  avatar_url: string | null
}

interface AuthState {
  user: string | null          // display_name (backward compat with old hook)
  userId: string | null        // UUID from auth.users
  role: AppRole | null
  profile: Profile | null
  isAuthenticated: boolean
  isPM: boolean
  isEditor: boolean
  isAdmin: boolean
  loading: boolean
  logout: () => void
}

export function useAuth(requireAuth = true): AuthState {
  const router = useRouter()
  const supabase = createClient()
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  // Fetch profile from profiles table
  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (data) {
      setProfile(data as Profile)
    }
    return data as Profile | null
  }, [supabase])

  // Initialize auth state
  useEffect(() => {
    const initAuth = async () => {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        setAuthUser(user)
        await fetchProfile(user.id)
      } else if (requireAuth) {
        router.push('/login')
      }
      setLoading(false)
    }

    initAuth()

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          setAuthUser(session.user)
          await fetchProfile(session.user.id)
        } else if (event === 'SIGNED_OUT') {
          setAuthUser(null)
          setProfile(null)
          if (requireAuth) {
            router.push('/login')
          }
        }
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase, requireAuth, router, fetchProfile])

  const logout = useCallback(async () => {
    await supabase.auth.signOut()
    // Also clear old localStorage keys for clean migration
    localStorage.removeItem('qc_user')
    localStorage.removeItem('qc_role')
    localStorage.removeItem('qc_auth')
    router.push('/login')
  }, [supabase, router])

  const role = profile?.role ?? null

  return {
    user: profile?.display_name ?? null,
    userId: authUser?.id ?? null,
    role,
    profile,
    isAuthenticated: !!authUser && !!profile,
    isPM: role === 'production_manager' || role === 'admin',
    isEditor: role === 'editor',
    isAdmin: role === 'admin',
    loading,
    logout,
  }
}
