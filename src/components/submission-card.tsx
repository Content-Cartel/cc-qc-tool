'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Clock, ArrowRight } from 'lucide-react'
import { timeAgo } from '@/lib/utils/date'
import { STATUS_CONFIG, CONTENT_TYPE_CONFIG } from '@/lib/constants'
import { PipelineStageLabel } from '@/components/pipeline-tracker'
import type { QCSubmission } from '@/lib/supabase/types'

interface SubmissionCardProps {
  submission: QCSubmission
  index?: number
}

export default function SubmissionCard({ submission, index = 0 }: SubmissionCardProps) {
  const status = STATUS_CONFIG[submission.status] || STATUS_CONFIG.pending
  const contentType = CONTENT_TYPE_CONFIG[submission.content_type] || CONTENT_TYPE_CONFIG.lf_video

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
    >
      <Link href={`/review/${submission.id}`}>
        <div className="card-glow p-4 group cursor-pointer">
          {/* Top row: title + content type */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
                {submission.title}
              </h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                {submission.client_name || 'Unknown Client'}
              </p>
            </div>
            <ArrowRight
              size={14}
              className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1"
              style={{ color: 'var(--gold)' }}
            />
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            <span className={`badge badge-${status.color}`}>{status.label}</span>
            <span className={`badge badge-${contentType.color}`}>{contentType.label}</span>
            {submission.revision_of && (
              <span className="badge badge-purple">Resubmission</span>
            )}
          </div>

          {/* Pipeline stage */}
          {submission.current_pipeline_stage && (
            <div className="mb-2">
              <PipelineStageLabel stage={submission.current_pipeline_stage} />
            </div>
          )}

          {/* Footer: editor + time */}
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-3)' }}>
            <span>{submission.submitted_by_name || 'Unknown'}</span>
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {timeAgo(submission.created_at)}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}
