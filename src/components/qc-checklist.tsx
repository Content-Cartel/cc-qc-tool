'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, AlertCircle } from 'lucide-react'
import { QC_CHECKLIST_ITEMS, type QCChecklistKey } from '@/lib/constants'
import { Progress } from '@/components/ui/progress'

interface QCChecklistProps {
  onSubmit: (results: Record<QCChecklistKey, boolean>, overallPass: boolean) => void
  existingResults?: Record<string, boolean>
  readOnly?: boolean
  loading?: boolean
}

export default function QCChecklist({ onSubmit, existingResults, readOnly = false, loading = false }: QCChecklistProps) {
  const [checks, setChecks] = useState<Record<string, boolean | null>>(() => {
    if (existingResults) {
      return { ...existingResults }
    }
    const initial: Record<string, boolean | null> = {}
    QC_CHECKLIST_ITEMS.forEach(item => { initial[item.key] = null })
    return initial
  })

  const passedCount = Object.values(checks).filter(v => v === true).length
  const failedCount = Object.values(checks).filter(v => v === false).length
  const uncheckedCount = Object.values(checks).filter(v => v === null).length
  const allChecked = uncheckedCount === 0
  const overallPass = allChecked && failedCount === 0

  function toggle(key: string) {
    if (readOnly) return
    setChecks(prev => {
      const current = prev[key]
      // Cycle: null → true → false → null
      let next: boolean | null
      if (current === null) next = true
      else if (current === true) next = false
      else next = null
      return { ...prev, [key]: next }
    })
  }

  function handleSubmit() {
    if (!allChecked) return
    const results = {} as Record<QCChecklistKey, boolean>
    QC_CHECKLIST_ITEMS.forEach(item => {
      results[item.key] = checks[item.key] === true
    })
    onSubmit(results, overallPass)
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>QC Checklist</h3>
        <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
          {passedCount}/{QC_CHECKLIST_ITEMS.length} passed
        </span>
      </div>

      <Progress
        value={passedCount}
        max={QC_CHECKLIST_ITEMS.length}
        color={overallPass ? 'green' : failedCount > 0 ? 'red' : 'gold'}
        size="sm"
      />

      <div className="mt-3 space-y-0.5">
        <AnimatePresence>
          {QC_CHECKLIST_ITEMS.map((item, i) => {
            const val = checks[item.key]
            const isPassed = val === true
            const isFailed = val === false
            const isUnchecked = val === null

            return (
              <motion.div
                key={item.key}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => toggle(item.key)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-100"
                style={{
                  cursor: readOnly ? 'default' : 'pointer',
                  background: isFailed ? 'rgba(239, 68, 68, 0.06)' : isPassed ? 'rgba(34, 197, 94, 0.04)' : 'transparent',
                }}
              >
                {/* Toggle icon */}
                <div
                  className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-all duration-150"
                  style={{
                    background: isPassed ? 'var(--green)' : isFailed ? 'var(--red)' : 'var(--surface-2)',
                    border: isUnchecked ? '1px solid var(--border-2)' : 'none',
                  }}
                >
                  {isPassed && <Check size={14} color="#000" strokeWidth={3} />}
                  {isFailed && <X size={14} color="#fff" strokeWidth={3} />}
                </div>

                {/* Label */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{
                    color: isFailed ? 'var(--red)' : isPassed ? 'var(--text)' : 'var(--text-2)',
                    textDecoration: isFailed ? 'line-through' : 'none',
                  }}>
                    {item.label}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
                    {item.description}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Result banner */}
      {allChecked && !readOnly && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-4 p-3 rounded-lg flex items-center gap-3"
          style={{
            background: overallPass ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${overallPass ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          }}
        >
          {overallPass ? (
            <Check size={18} style={{ color: 'var(--green)' }} />
          ) : (
            <AlertCircle size={18} style={{ color: 'var(--red)' }} />
          )}
          <span className="text-sm font-semibold" style={{ color: overallPass ? 'var(--green)' : 'var(--red)' }}>
            {overallPass ? 'ALL CHECKS PASSED' : `${failedCount} CHECK${failedCount > 1 ? 'S' : ''} FAILED`}
          </span>
        </motion.div>
      )}

      {/* Submit button */}
      {!readOnly && (
        <button
          onClick={handleSubmit}
          disabled={!allChecked || loading}
          className="w-full mt-3 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: allChecked ? (overallPass ? 'var(--green)' : 'var(--red)') : 'var(--surface-2)',
            color: allChecked ? '#000' : 'var(--text-3)',
          }}
        >
          {loading ? 'Submitting...' : allChecked
            ? (overallPass ? 'Approve — All Passed' : 'Request Revision — Failed Items')
            : `${uncheckedCount} item${uncheckedCount > 1 ? 's' : ''} remaining`}
        </button>
      )}
    </div>
  )
}
