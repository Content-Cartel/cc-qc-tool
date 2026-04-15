'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { UserPlus, Users, Link2, Trash2, Shield, Briefcase, Pencil, Check, X, Loader2, Key, Copy } from 'lucide-react'
import Nav from '@/components/nav'
import { useAuth } from '@/hooks/use-supabase-auth'
import { createClient } from '@/lib/supabase/client'
import type { Profile, EditorAssignment } from '@/lib/supabase/types'

interface ClientOption {
  id: number
  name: string
}

interface AssignmentWithJoins extends EditorAssignment {
  profiles: { display_name: string } | null
  clients: { name: string } | null
}

export default function AdminPage() {
  const supabase = createClient()
  const { isAdmin, loading: authLoading } = useAuth()

  const [profiles, setProfiles] = useState<Profile[]>([])
  const [assignments, setAssignments] = useState<AssignmentWithJoins[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [loading, setLoading] = useState(true)

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('editor')
  const [inviteSlack, setInviteSlack] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Assignment form
  const [assignEditorId, setAssignEditorId] = useState('')
  const [assignClientId, setAssignClientId] = useState<number | ''>('')
  const [assigning, setAssigning] = useState(false)

  // Activate user (set temp password)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [activatedCreds, setActivatedCreds] = useState<{ email: string; password: string; name: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [profilesRes, assignmentsRes, clientsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('display_name'),
      supabase.from('editor_assignments').select('*, profiles(display_name), clients(name)').order('assigned_at', { ascending: false }),
      supabase.from('clients').select('id, name').in('phase', ['production', 'active', 'onboarding']).order('name'),
    ])
    setProfiles((profilesRes.data || []) as Profile[])
    setAssignments((assignmentsRes.data || []) as AssignmentWithJoins[])
    setClients((clientsRes.data || []) as ClientOption[])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (!authLoading) loadData()
  }, [authLoading, loadData])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setInviteMsg(null)

    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          display_name: inviteName.trim(),
          role: inviteRole,
          slack_user_id: inviteSlack.trim() || undefined,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setInviteMsg({ type: 'error', text: data.error || 'Failed to invite user' })
      } else {
        setInviteMsg({ type: 'success', text: `Invite sent to ${inviteEmail}` })
        setInviteEmail('')
        setInviteName('')
        setInviteSlack('')
        loadData()
      }
    } catch {
      setInviteMsg({ type: 'error', text: 'Something went wrong' })
    }
    setInviting(false)
  }

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!assignEditorId || !assignClientId) return
    setAssigning(true)

    const { error } = await supabase.from('editor_assignments').insert({
      editor_id: assignEditorId,
      client_id: assignClientId,
    })

    if (!error) {
      setAssignEditorId('')
      setAssignClientId('')
      loadData()
    }
    setAssigning(false)
  }

  const handleRemoveAssignment = async (id: string) => {
    await supabase.from('editor_assignments').delete().eq('id', id)
    loadData()
  }

  const handleActivate = async (profile: Profile) => {
    if (!confirm(`Set a temporary password for ${profile.display_name}? This will overwrite any existing password.`)) return
    setActivatingId(profile.id)
    try {
      const res = await fetch('/api/admin/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: profile.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to set password')
      } else {
        setActivatedCreds({
          email: data.email || profile.email || '',
          password: data.password,
          name: profile.display_name,
        })
        setCopied(false)
      }
    } catch {
      alert('Something went wrong')
    }
    setActivatingId(null)
  }

  const copyCredentials = async () => {
    if (!activatedCreds) return
    const text = `Email: ${activatedCreds.email}\nPassword: ${activatedCreds.password}\n\nLog in at: https://qc.contentcartel.net/login`
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <Nav />
        <main className="max-w-4xl mx-auto px-4 py-8">
          <div className="card p-6 animate-shimmer h-64" />
        </main>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <Nav />
        <main className="max-w-4xl mx-auto px-4 py-8 text-center">
          <Shield size={32} style={{ color: 'var(--red)' }} className="mx-auto mb-3" />
          <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--text)' }}>Access Denied</h1>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>Admin access required.</p>
        </main>
      </div>
    )
  }

  const editors = profiles.filter(p => p.role === 'editor')

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--text)' }}>Admin</h1>
          <p className="text-xs mb-8" style={{ color: 'var(--text-3)' }}>Manage team members and client assignments</p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Invite User */}
            <div className="card p-6">
              <div className="flex items-center gap-2 mb-4">
                <UserPlus size={16} style={{ color: 'var(--gold)' }} />
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Invite User</h2>
              </div>
              <form onSubmit={handleInvite} className="space-y-3">
                <div>
                  <label className="label">Name</label>
                  <input
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    className="input"
                    placeholder="Full name"
                    required
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="input"
                    placeholder="user@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="label">Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="input"
                  >
                    <option value="editor">Editor</option>
                    <option value="production_manager">Production Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="label">Slack User ID (optional)</label>
                  <input
                    type="text"
                    value={inviteSlack}
                    onChange={(e) => setInviteSlack(e.target.value)}
                    className="input"
                    placeholder="U0ABC12345"
                  />
                </div>
                {inviteMsg && (
                  <p className="text-xs" style={{ color: inviteMsg.type === 'success' ? 'var(--green)' : 'var(--red)' }}>
                    {inviteMsg.text}
                  </p>
                )}
                <button type="submit" disabled={inviting} className="btn-primary w-full text-sm">
                  {inviting ? 'Sending Invite...' : 'Send Invite'}
                </button>
              </form>
            </div>

            {/* Assign Editor → Client */}
            <div className="card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Link2 size={16} style={{ color: 'var(--gold)' }} />
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Assign Editor → Client</h2>
              </div>
              <form onSubmit={handleAssign} className="space-y-3">
                <div>
                  <label className="label">Editor</label>
                  <select
                    value={assignEditorId}
                    onChange={(e) => setAssignEditorId(e.target.value)}
                    className="input"
                    required
                  >
                    <option value="">Select editor...</option>
                    {editors.map((e) => (
                      <option key={e.id} value={e.id}>{e.display_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Client</label>
                  <select
                    value={assignClientId}
                    onChange={(e) => setAssignClientId(Number(e.target.value))}
                    className="input"
                    required
                  >
                    <option value="">Select client...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" disabled={assigning} className="btn-primary w-full text-sm">
                  {assigning ? 'Assigning...' : 'Assign'}
                </button>
              </form>
            </div>
          </div>

          {/* Team Members */}
          <div className="card p-6 mt-6">
            <div className="flex items-center gap-2 mb-4">
              <Users size={16} style={{ color: 'var(--gold)' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Team Members</h2>
              <span className="badge badge-neutral text-xs ml-auto">{profiles.length} members</span>
            </div>
            <div className="space-y-2">
              {profiles.map((p) => {
                const roleColor = p.role === 'admin' ? 'gold' : p.role === 'production_manager' ? 'purple' : 'blue'
                const roleLabel = p.role === 'production_manager' ? 'PM' : p.role === 'admin' ? 'Admin' : 'Editor'
                const editorAssignments = assignments.filter(a => a.editor_id === p.id)
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-3 rounded-lg"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: `var(--${roleColor})`, color: roleColor === 'gold' ? '#000' : '#fff', opacity: 0.8 }}
                      >
                        {p.display_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>{p.display_name}</div>
                        <div className="text-xs" style={{ color: 'var(--text-3)' }}>{p.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {editorAssignments.length > 0 && (
                        <div className="flex gap-1 flex-wrap justify-end max-w-[200px]">
                          {editorAssignments.map(a => (
                            <span key={a.id} className="badge badge-neutral text-[10px] flex items-center gap-1">
                              {a.clients?.name}
                              <button
                                onClick={() => handleRemoveAssignment(a.id)}
                                className="hover:text-red-400 transition-colors"
                              >
                                <X size={10} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <span className={`badge badge-${roleColor} text-xs`}>{roleLabel}</span>
                      <button
                        onClick={() => handleActivate(p)}
                        disabled={activatingId === p.id}
                        className="p-1.5 rounded-md transition-colors hover:bg-[var(--surface)] disabled:opacity-50"
                        title="Set temporary password (activate user without email)"
                      >
                        {activatingId === p.id
                          ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--gold)' }} />
                          : <Key size={12} style={{ color: 'var(--gold)' }} />}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Current Assignments */}
          <div className="card p-6 mt-6">
            <div className="flex items-center gap-2 mb-4">
              <Briefcase size={16} style={{ color: 'var(--gold)' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Editor → Client Assignments</h2>
              <span className="badge badge-neutral text-xs ml-auto">{assignments.length} assignments</span>
            </div>
            {assignments.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: 'var(--text-3)' }}>
                No assignments yet. Assign editors to clients above.
              </p>
            ) : (
              <div className="space-y-2">
                {assignments.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between p-3 rounded-lg"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <span style={{ color: 'var(--text)' }}>{a.profiles?.display_name || 'Unknown'}</span>
                      <span style={{ color: 'var(--text-3)' }}>→</span>
                      <span className="badge badge-gold text-xs">{a.clients?.name || 'Unknown'}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveAssignment(a.id)}
                      className="p-1.5 rounded-md transition-colors hover:bg-[var(--surface)]"
                      title="Remove assignment"
                    >
                      <Trash2 size={12} style={{ color: 'var(--red)' }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* Credentials Modal */}
        {activatedCreds && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onClick={() => setActivatedCreds(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="card p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-3">
                <Key size={16} style={{ color: 'var(--gold)' }} />
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  Credentials for {activatedCreds.name}
                </h2>
              </div>
              <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
                Copy and share these credentials with the user via Slack or DM. This password will not be shown again.
              </p>
              <div className="space-y-2 mb-4">
                <div>
                  <label className="label">Email</label>
                  <div
                    className="px-3 py-2 rounded-md text-sm font-mono"
                    style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
                  >
                    {activatedCreds.email}
                  </div>
                </div>
                <div>
                  <label className="label">Temporary Password</label>
                  <div
                    className="px-3 py-2 rounded-md text-sm font-mono select-all"
                    style={{ background: 'var(--surface-2)', color: 'var(--gold)' }}
                  >
                    {activatedCreds.password}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copyCredentials}
                  className="btn-primary flex-1 text-sm flex items-center justify-center gap-2"
                >
                  {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy full message</>}
                </button>
                <button
                  onClick={() => setActivatedCreds(null)}
                  className="px-4 py-2 rounded-md text-sm transition-colors hover:bg-[var(--surface-2)]"
                  style={{ color: 'var(--text-3)' }}
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </main>
    </div>
  )
}
