'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const storedRole = localStorage.getItem('qc_role')
    const storedUser = localStorage.getItem('qc_user')

    if (storedRole && storedUser) {
      if (storedRole === 'pm' || storedRole === 'admin') {
        router.push('/dashboard')
      } else {
        router.push('/submit')
      }
    } else {
      router.push('/login')
    }
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
