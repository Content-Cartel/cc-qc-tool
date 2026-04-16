'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { UserPlus, Users, Link2, Shield, Check, X, Loader2, Key, Copy, AlertCircle, RefreshCw } from 'lucide-react'
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
  const { isPM, loading: authLoading } = useAuth()

  const [profiles, setProfiles] = useState<Profile[]>([])
  const [assignments, setAssignments] = useState<AssignmentWithJoins[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('editor')
  const [inviteSlack, setInviteSlack] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Activate user (set temp password)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [activatedCreds, setActivatedCreds] = useState<{ email: string; password: string; name: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // Manage client assignments for an editor
  const [manageEditor, setManageEditor] = useState<Profile | null>(null)
  const [selectedClientIds, setSelectedClientIds] = useState<Set<number>>(new Set())
  const [savingAssignments, setSavingAssignments] = useState(false)

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setLoadError(null)
    try {
      const [profilesRes, assignmentsRes, clientsRes] = await Promise.all([
        supabase.from('profiles').select('*').order('display_name'),
        // Specify FK explicitly (editor_id) — editor_assignments has two FKs
        // to profiles (editor_id + assigned_by) so PostgREST can't auto-pick.
        supabase.from('editor_assignments').select('*, profiles!editor_id(display_name), clients(name)').order('assigned_at', { ascending: false }),
        supabase.from('clients').select('id, name').in('phase', ['production', 'active', 'onboarding']).order('name'),
      ])
      // Surface the first non-RLS error if any query failed
      const firstError = profilesRes.error || assignmentsRes.error || clientsRes.error
      if (firstError) {
        console.error('Admin loadData error:', firstError)
        setLoadError(firstError.message || 'Failed to load admin data')
      }
      setProfiles((profilesRes.data || []) as Profile[])
      setAssignments((assignmentsRes.data || []) as AssignmentWithJoins[])
      setClients((clientsRes.data || []) as ClientOption[])
    } catch (err) {
      console.error('Admin loadData threw:', err)
      setLoadError(err instanceof Error ? err.message : 'Unknown error loading admin data')
    } finally {
      setLoading(false)
    }
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
        loadData(true)
      }
    } catch {
      setInviteMsg({ type: 'error', text: 'Something went wrong' })
    }
    setInviting(false)
  }

  const openManageModal = (editor: Profile) => {
    const currentClientIds = assignments
      .filter(a => a.editor_id === editor.id)
      .map(a => a.client_id)
    setSelectedClientIds(new Set(currentClientIds))
    setManageEditor(editor)
  }

  const toggleClientSelection = (clientId: number) => {
    setSelectedClientIds(prev => {
      const next = new Set(prev)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  const saveAssignments = async () => {
    if (!manageEditor) return
    setSavingAssignments(true)

    const currentAssignmentsForEditor = assignments.filter(a => a.editor_id === manageEditor.id)
    const currentClientIds = new Set(currentAssignmentsForEditor.map(a => a.client_id))

    const toAdd: number[] = []
    selectedClientIds.forEach(id => { if (!currentClientIds.has(id)) toAdd.push(id) })

    const toRemoveIds: string[] = currentAssignmentsForEditor
      .filter(a => !selectedClientIds.has(a.client_id))
      .map(a => a.id)

    const ops: Promise<unknown>[] = []
    if (toAdd.length > 0) {
      ops.push(
        supabase.from('editor_assignments').insert(
          toAdd.map(cid => ({ editor_id: manageEditor.id, client_id: cid }))
        )
      )
    }
    if (toRemoveIds.length > 0) {
      ops.push(supabase.from('editor_assignments').delete().in('id', toRemoveIds))
    }
    await Promise.all(ops)

    setSavingAssignments(false)
    setManageEditor(null)
    loadData(true)
  }

  const handleRemoveAssignment = async (id: string) => {
    await supabase.from('editor_assignments').delete().eq('id', id)
    loadData(true)
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

  if (loadError) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <Nav />
        <main className="max-w-4xl mx-auto px-4 py-8 text-center">
          <AlertCircle size={32} style={{ color: 'var(--red)' }} className="mx-auto mb-3" />
          <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--text)' }}>Couldn&rsquo;t load admin data</h1>
          <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>{loadError}</p>
          <button onClick={loadData} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <RefreshCw size={12} /> Retry
          </button>
        </main>
      </div>
    )
  }

  if (!isPM) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <Nav />
        <main className="max-w-4xl mx-auto px-4 py-8 text-center">
          <Shield size={32} style={{ color: 'var(--red)' }} className="mx-auto mb-3" />
          <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--text)' }}>Access Denied</h1>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>Production manager or admin access required.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--text)' }}>Admin</h1>
          <p className="text-xs mb-8" style={{ color: 'var(--text-3)' }}>Manage team members and client assignments</p>

          <div className="max-w-lg">
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
                      {p.role === 'editor' && (
                        <button
                          onClick={() => openManageModal(p)}
                          className="p-1.5 rounded-md transition-colors hover:bg-[var(--surface)]"
                          title="Manage client assignments"
                        >
                          <Link2 size={12} style={{ color: 'var(--gold)' }} />
                        </button>
                      )}
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

        </motion.div>

        {/* Manage Client Assignments Modal */}
        {manageEditor && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onClick={() => !savingAssignments && setManageEditor(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="card p-6 max-w-md w-full max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-3">
                <Link2 size={16} style={{ color: 'var(--gold)' }} />
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  Manage clients for {manageEditor.display_name}
                </h2>
              </div>
              <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
                Check every client this editor works on. Changes save on click.
              </p>
              <div className="flex-1 overflow-y-auto space-y-1 mb-4">
                {clients.length === 0 ? (
                  <p className="text-xs text-center py-4" style={{ color: 'var(--text-3)' }}>
                    No active clients found.
                  </p>
                ) : (
                  clients.map((c) => {
                    const checked = selectedClientIds.has(c.id)
                    return (
                      <label
                        key={c.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors hover:bg-[var(--surface-2)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleClientSelection(c.id)}
                          className="w-4 h-4 rounded cursor-pointer"
                          style={{ accentColor: 'var(--gold)' }}
                        />
                        <span className="text-sm" style={{ color: checked ? 'var(--text)' : 'var(--text-3)' }}>
                          {c.name}
                        </span>
                      </label>
                    )
                  })
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveAssignments}
                  disabled={savingAssignments}
                  className="btn-primary flex-1 text-sm flex items-center justify-center gap-2"
                >
                  {savingAssignments
                    ? <><Loader2 size={14} className="animate-spin" /> Saving...</>
                    : <><Check size={14} /> Save</>}
                </button>
                <button
                  onClick={() => setManageEditor(null)}
                  disabled={savingAssignments}
                  className="px-4 py-2 rounded-md text-sm transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
                  style={{ color: 'var(--text-3)' }}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}

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
