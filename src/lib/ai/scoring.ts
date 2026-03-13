import { STATUS_CONFIG } from '@/lib/constants'

export function getStatusColor(status: string): string {
  const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]
  if (!config) return 'badge-neutral'
  return `badge-${config.color}`
}

export function getStatusLabel(status: string): string {
  const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]
  return config?.label || status
}
