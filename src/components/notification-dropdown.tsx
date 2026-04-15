'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { Bell, Check, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-supabase-auth'
import { timeAgo } from '@/lib/utils/date'
import type { Notification } from '@/lib/supabase/types'

export default function NotificationDropdown() {
  const supabase = createClient()
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const unreadCount = notifications.filter(n => !n.is_read).length

  const loadNotifications = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_name', user)
      .order('created_at', { ascending: false })
      .limit(20)

    if (data) setNotifications(data as Notification[])
  }, [supabase, user])

  useEffect(() => {
    loadNotifications()

    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
      }, () => {
        loadNotifications()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase, loadNotifications])

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function markAllRead() {
    if (!user) return
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_name', user)
      .eq('is_read', false)
    await loadNotifications()
  }

  async function markRead(id: string) {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
    await loadNotifications()
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 rounded-md transition-colors hover:bg-[var(--surface-2)]"
        title="Notifications"
      >
        <Bell size={14} style={{ color: 'var(--text-3)' }} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[10px] font-bold px-1"
            style={{ background: 'var(--red)', color: '#fff' }}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 w-80 rounded-lg shadow-lg overflow-hidden z-50"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-medium" style={{ color: 'var(--text)' }}>
              Notifications
            </span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[10px] flex items-center gap-1 transition-colors"
                  style={{ color: 'var(--text-3)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
                >
                  <Check size={10} />
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-0.5 rounded transition-colors"
                style={{ color: 'var(--text-3)' }}
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <Link
                  key={n.id}
                  href={n.submission_id ? `/review/${n.submission_id}` : '#'}
                  onClick={() => {
                    if (!n.is_read) markRead(n.id)
                    setOpen(false)
                  }}
                  className="block px-3 py-2.5 transition-colors"
                  style={{
                    background: n.is_read ? 'transparent' : 'rgba(234, 179, 8, 0.04)',
                    borderBottom: '1px solid var(--border)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = n.is_read ? 'transparent' : 'rgba(234, 179, 8, 0.04)')}
                >
                  <div className="flex items-start gap-2">
                    {!n.is_read && (
                      <span
                        className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: 'var(--gold)' }}
                      />
                    )}
                    <div className={n.is_read ? 'pl-3.5' : ''}>
                      <p className="text-xs" style={{ color: n.is_read ? 'var(--text-3)' : 'var(--text)' }}>
                        {n.message}
                      </p>
                      <span className="text-[10px] mt-0.5 block" style={{ color: 'var(--text-3)' }}>
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
