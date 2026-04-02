'use client'

import Image from 'next/image'
import { LogOut } from 'lucide-react'

interface ClientNavProps {
  displayName: string
  clientName: string | null
  onLogout: () => void
}

export default function ClientNav({ displayName, clientName, onLogout }: ClientNavProps) {
  return (
    <nav className="sticky top-0 z-50 backdrop-blur-md" style={{ background: 'rgba(9, 9, 11, 0.85)', borderBottom: '1px solid var(--border)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-12">
          <div className="flex items-center gap-3">
            <Image
              src="/cc-logo.png"
              alt="Content Cartel"
              width={32}
              height={32}
              className="rounded"
            />
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {displayName}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--gold)', color: '#000', fontWeight: 600 }}>
                Client Portal
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {clientName && (
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                {clientName}
              </span>
            )}
            <button
              onClick={onLogout}
              className="p-1.5 rounded-md transition-colors hover:bg-[var(--surface-2)]"
              title="Logout"
            >
              <LogOut size={14} style={{ color: 'var(--text-3)' }} />
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
