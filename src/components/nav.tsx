'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { LayoutDashboard, Upload, FileCheck, GitBranch, LogOut, Dna } from 'lucide-react'

export default function Nav() {
  const pathname = usePathname()
  const { user, role, isPM, logout } = useAuth()

  const navItems = isPM
    ? [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/pipeline', label: 'Pipeline', icon: GitBranch },
        { href: '/dna', label: 'DNA', icon: Dna },
      ]
    : [
        { href: '/submit', label: 'Submit', icon: Upload },
        { href: '/my-submissions', label: 'My Work', icon: FileCheck },
      ]

  return (
    <nav className="sticky top-0 z-50 backdrop-blur-md" style={{ background: 'rgba(9, 9, 11, 0.85)', borderBottom: '1px solid var(--border)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-12">
          <div className="flex items-center gap-6">
            {/* Logo */}
            <Link href={isPM ? '/dashboard' : '/submit'} className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-black"
                style={{ background: 'var(--gold)', color: '#000' }}
              >
                CC
              </span>
              <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>QC</span>
            </Link>

            {/* Nav items */}
            <div className="flex items-center gap-0.5">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-100"
                    style={{
                      background: isActive ? 'var(--surface-2)' : 'transparent',
                      color: isActive ? 'var(--text)' : 'var(--text-3)',
                    }}
                  >
                    <Icon size={14} />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              {user}
            </span>
            <span className="badge badge-neutral text-xs">{role}</span>
            <button
              onClick={logout}
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
