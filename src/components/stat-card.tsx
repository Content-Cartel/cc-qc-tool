'use client'

import { motion } from 'framer-motion'

interface StatCardProps {
  label: string
  value: number
  color: 'blue' | 'amber' | 'green' | 'red' | 'gold'
  icon?: React.ReactNode
}

const colorMap = {
  blue: { bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.2)', text: 'var(--blue)' },
  amber: { bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.2)', text: 'var(--amber)' },
  green: { bg: 'rgba(34, 197, 94, 0.1)', border: 'rgba(34, 197, 94, 0.2)', text: 'var(--green)' },
  red: { bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.2)', text: 'var(--red)' },
  gold: { bg: 'rgba(212, 168, 67, 0.1)', border: 'rgba(212, 168, 67, 0.2)', text: 'var(--gold)' },
}

export default function StatCard({ label, value, color, icon }: StatCardProps) {
  const c = colorMap[color]
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl p-4 transition-all duration-150"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
          {label}
        </span>
        {icon && <span style={{ color: c.text }}>{icon}</span>}
      </div>
      <p className="text-2xl font-bold" style={{ color: c.text }}>{value}</p>
    </motion.div>
  )
}
