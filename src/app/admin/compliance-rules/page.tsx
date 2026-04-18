'use client'

import { useState, useEffect, useCallback } from 'react'
import { Shield, Save, Check, Loader2, AlertCircle } from 'lucide-react'
import Nav from '@/components/nav'
import { useAuth } from '@/hooks/use-supabase-auth'
import { createClient } from '@/lib/supabase/client'

interface ClientRow {
  id: number
  name: string
  phase: string | null
  compliance_rules: string | null
}

export default function ComplianceRulesPage() {
  const supabase = createClient()
  const { isPM, loading: authLoading } = useAuth()

  const [clients, setClients] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Editing state — tracked per client_id to allow in-place edits.
  const [edits, setEdits] = useState<Record<number, string>>({})
  const [savingId, setSavingId] = useState<number | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)
  const [errorById, setErrorById] = useState<Record<number, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, phase, compliance_rules')
        .in('phase', ['production', 'active', 'onboarding', 'special'])
        .order('name')
      if (error) {
        setLoadError(error.message || 'Failed to load clients')
      }
      setClients((data || []) as ClientRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load clients')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    load()
  }, [load])

  function handleChange(clientId: number, value: string) {
    setEdits(prev => ({ ...prev, [clientId]: value }))
    setSavedId(null)
    setErrorById(prev => {
      if (!prev[clientId]) return prev
      const next = { ...prev }
      delete next[clientId]
      return next
    })
  }

  async function handleSave(clientId: number) {
    const current = edits[clientId] ?? clients.find(c => c.id === clientId)?.compliance_rules ?? ''
    setSavingId(clientId)
    setSavedId(null)
    setErrorById(prev => {
      const next = { ...prev }
      delete next[clientId]
      return next
    })
    try {
      const res = await fetch(`/api/admin/compliance-rules/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compliance_rules: current }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      // Refresh the row so server state is reflected in the UI.
      setClients(prev =>
        prev.map(c => (c.id === clientId ? { ...c, compliance_rules: current } : c)),
      )
      setEdits(prev => {
        const next = { ...prev }
        delete next[clientId]
        return next
      })
      setSavedId(clientId)
      setTimeout(() => setSavedId(s => (s === clientId ? null : s)), 2500)
    } catch (err) {
      setErrorById(prev => ({
        ...prev,
        [clientId]: err instanceof Error ? err.message : 'Save failed',
      }))
    } finally {
      setSavingId(s => (s === clientId ? null : s))
    }
  }

  if (authLoading || loading) {
    return (
      <>
        <Nav />
        <main className="max-w-5xl mx-auto p-6">
          <div className="flex items-center gap-2 text-[var(--text-3)]">
            <Loader2 size={16} className="animate-spin" />
            Loading…
          </div>
        </main>
      </>
    )
  }

  if (!isPM) {
    return (
      <>
        <Nav />
        <main className="max-w-5xl mx-auto p-6">
          <div className="card p-4 flex items-center gap-2">
            <AlertCircle size={18} className="text-[var(--text-3)]" />
            <span>This page is only accessible to PMs and admins.</span>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Nav />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex items-start gap-3">
          <Shield size={24} className="text-[var(--text-2)] mt-1" />
          <div>
            <h1 className="text-xl font-semibold">Compliance rules</h1>
            <p className="text-sm text-[var(--text-3)] mt-1 max-w-2xl">
              Hard-line rules per client. These render as <code>RULE TWO — CLIENT COMPLIANCE</code>{' '}
              near the top of the generation system prompt, and the model is required to silently
              self-check every draft against them before emitting. Plain text, one rule per bullet
              or line — the model sees exactly what you type.
            </p>
            <p className="text-xs text-[var(--text-3)] mt-2">
              Example rules: <em>&quot;Any yield rate must include [LEGAL REVIEW REQUIRED]&quot;</em>,{' '}
              <em>&quot;Never use politicized framing&quot;</em>,{' '}
              <em>&quot;Every CTA must tie to the specific opportunity raised in this post&quot;</em>.
            </p>
          </div>
        </header>

        {loadError && (
          <div className="card p-3 flex items-center gap-2 text-sm">
            <AlertCircle size={16} className="text-[var(--red)]" />
            {loadError}
          </div>
        )}

        <div className="space-y-4">
          {clients.map(c => {
            const value = edits[c.id] ?? c.compliance_rules ?? ''
            const hasEdit = edits[c.id] !== undefined && edits[c.id] !== (c.compliance_rules ?? '')
            const isSaving = savingId === c.id
            const isSaved = savedId === c.id
            const err = errorById[c.id]
            return (
              <div key={c.id} className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-[var(--text-3)]">
                      id={c.id} · phase={c.phase || 'n/a'} · {value ? `${value.length} chars` : 'no rules yet'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isSaved && (
                      <span className="text-xs text-[var(--green)] flex items-center gap-1">
                        <Check size={14} /> Saved
                      </span>
                    )}
                    {err && (
                      <span className="text-xs text-[var(--red)] flex items-center gap-1">
                        <AlertCircle size={14} /> {err}
                      </span>
                    )}
                    <button
                      onClick={() => handleSave(c.id)}
                      disabled={!hasEdit || isSaving}
                      className="btn-primary text-xs flex items-center gap-1 px-3 py-1.5"
                    >
                      {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      Save
                    </button>
                  </div>
                </div>
                <textarea
                  className="input w-full font-mono text-xs"
                  rows={Math.min(20, Math.max(6, value.split('\n').length + 2))}
                  placeholder="One rule per line. Plain text — the model sees exactly what you write.
Example:
- Any yield rate (X% annually) MUST include [LEGAL REVIEW REQUIRED — JEFF SIGN-OFF].
- NEVER use politicized framing ('war on X', 'so-called').
- Every CTA must tie to the specific pain or opportunity raised in THIS post."
                  value={value}
                  onChange={e => handleChange(c.id, e.target.value)}
                />
              </div>
            )
          })}
        </div>
      </main>
    </>
  )
}
