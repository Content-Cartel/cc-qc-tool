'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const redirect = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (!profile) {
        router.push('/login')
        return
      }

      if (profile.role === 'production_manager' || profile.role === 'admin') {
        router.push('/dashboard')
      } else {
        router.push('/tasks')
      }
    }

    redirect()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-10 h-10 rounded-full animate-pulse-gold"
          style={{ background: 'var(--gold)', opacity: 0.6 }}
        />
        <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
          Loading...
        </span>
      </div>
    </div>
  )
}
