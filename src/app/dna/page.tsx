'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Dna, Check, Clock, AlertCircle, ExternalLink, RefreshCw, Zap } from 'lucide-react'
import Link from 'next/link'
import Nav from '@/components/nav'
import { createClient } from '@/lib/supabase/client'
import type { ClientDNA } from '@/lib/dna/types'
import { parseDNASections } from '@/lib/dna/parser'

interface ClientWithDNA {
  id: number
  name: string
  phase: string
  latestDna: ClientDNA | null
  healthScore: number | null
  highConfCount: number
  totalSections: number
}

export default function DNADashboardPage() {
  const supabase = createClient()
  const [clients, setClients] = useState<ClientWithDNA[]>([])
  const [loading, setLoading] = useState(true)

  const loadClients = useCallback(async () => {
    setLoading(true)

    const { data: clientData } = await supabase
      .from('clients')
      .select('id, name, phase')
      .in('phase', ['production', 'active', 'onboarding'])
      .order('name')

    if (!clientData) {
      setLoading(false)
      return
    }

    const { data: dnaData } = await supabase
      .from('client_dna')
      .select('*')
      .order('version', { ascending: false })

    const dnaByClient = new Map<number, ClientDNA>()
    if (dnaData) {
      for (const dna of dnaData) {
        if (!dnaByClient.has(dna.client_id)) {
          dnaByClient.set(dna.client_id, dna as ClientDNA)
        }
      }
    }

    setClients(clientData.map(c => {
      const latestDna = dnaByClient.get(c.id) || null
      let healthScore: number | null = null
      let highConfCount = 0
      let totalSections = 0

      if (latestDna?.dna_markdown) {
        const parsed = parseDNASections(latestDna.dna_markdown)
        healthScore = parsed.overallScore
        highConfCount = parsed.highConfCount
        totalSections = parsed.sections.length
      }

      return { ...c, latestDna, healthScore, highConfCount, totalSections }
    }))
    setLoading(false)
  }, [supabase])

  useEffect(() => { loadClients() }, [loadClients])

  const withDna = clients.filter(c => c.latestDna)
  const withoutDna = clients.filter(c => !c.latestDna)

  function getScoreColor(score: number) {
    if (score > 70) return 'var(--green)'
    if (score > 40) return 'var(--amber)'
    return 'var(--red)'
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Nav />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <Dna size={20} style={{ color: 'var(--gold)' }} />
              Client DNA Profiles
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
              Generate and manage brand DNA for each client
            </p>
          </div>
          <button
            onClick={loadClients}
            className="btn-ghost text-xs flex items-center gap-1.5"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>

        {/* Stats bar */}
        {!loading && clients.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="card p-3 text-center">
              <p className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{clients.length}</p>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Total Clients</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-2xl font-bold" style={{ color: 'var(--green)' }}>{withDna.length}</p>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>DNA Generated</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-2xl font-bold" style={{ color: 'var(--amber)' }}>{withoutDna.length}</p>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Needs DNA</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="card p-4 animate-shimmer h-36" />
            ))}
          </div>
        ) : (
          <>
            {/* Clients without DNA */}
            {withoutDna.length > 0 && (
              <div className="mb-6">
                <h2 className="text-xs font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                  <AlertCircle size={12} style={{ color: 'var(--amber)' }} />
                  Needs DNA ({withoutDna.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {withoutDna.map((client, i) => (
                    <motion.div
                      key={client.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                    >
                      <Link
                        href={`/dna/generate/${client.id}`}
                        className="card p-4 block group"
                        style={{ borderColor: 'rgba(245, 158, 11, 0.3)' }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                            {client.name}
                          </span>
                          <span className="badge badge-neutral text-[10px]">{client.phase}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs font-medium mt-2 group-hover:gap-2 transition-all" style={{ color: 'var(--gold)' }}>
                          <Zap size={12} />
                          Generate DNA
                        </div>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Clients with DNA */}
            {withDna.length > 0 && (
              <div>
                <h2 className="text-xs font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                  <Check size={12} style={{ color: 'var(--green)' }} />
                  DNA Generated ({withDna.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {withDna.map((client, i) => (
                    <motion.div
                      key={client.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                    >
                      <div className="card-glow p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                            {client.name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {client.healthScore !== null && (
                              <span
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                                style={{
                                  color: getScoreColor(client.healthScore),
                                  background: `color-mix(in srgb, ${getScoreColor(client.healthScore)} 15%, transparent)`,
                                }}
                              >
                                {client.healthScore}%
                              </span>
                            )}
                            <span className="badge badge-green text-[10px]">v{client.latestDna!.version}</span>
                          </div>
                        </div>

                        {/* Health bar */}
                        {client.healthScore !== null && (
                          <div className="mb-3">
                            <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: 'var(--text-3)' }}>
                              <span>{client.highConfCount}/{client.totalSections} sections confident</span>
                            </div>
                            <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${client.healthScore}%`,
                                  background: getScoreColor(client.healthScore),
                                }}
                              />
                            </div>
                          </div>
                        )}

                        <div className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>
                          <Clock size={10} className="inline mr-1" />
                          {new Date(client.latestDna!.created_at).toLocaleDateString()}
                        </div>

                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dna/${client.id}`}
                            className="flex items-center gap-1 text-xs font-medium"
                            style={{ color: 'var(--gold)' }}
                          >
                            <ExternalLink size={11} />
                            View
                          </Link>
                          <Link
                            href={`/dna/generate/${client.id}`}
                            className="flex items-center gap-1 text-xs font-medium"
                            style={{ color: 'var(--text-3)' }}
                          >
                            <RefreshCw size={11} />
                            Regenerate
                          </Link>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {clients.length === 0 && (
              <div className="card p-8 text-center">
                <Dna size={32} className="mx-auto mb-3" style={{ color: 'var(--text-3)' }} />
                <p className="text-sm" style={{ color: 'var(--text-2)' }}>No clients found</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
