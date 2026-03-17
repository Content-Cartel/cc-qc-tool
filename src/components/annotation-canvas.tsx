'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Pencil, Eraser, Download, X } from 'lucide-react'

interface AnnotationCanvasProps {
  active: boolean
  onSave: (imageDataUrl: string) => void
  onClose: () => void
}

const COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'White', value: '#ffffff' },
]

const BRUSH_SIZES = [2, 4, 8]

export default function AnnotationCanvas({ active, onSave, onClose }: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [color, setColor] = useState('#ef4444')
  const [brushSize, setBrushSize] = useState(4)
  const [hasDrawn, setHasDrawn] = useState(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  // Resize canvas to match parent
  useEffect(() => {
    if (!active || !canvasRef.current) return
    const canvas = canvasRef.current
    const parent = canvas.parentElement
    if (!parent) return

    const resize = () => {
      const rect = parent.getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height
    }
    resize()

    const observer = new ResizeObserver(resize)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [active])

  const getPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }, [])

  const startDrawing = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const pos = getPos(e)
    lastPos.current = pos
    setIsDrawing(true)
    setHasDrawn(true)

    // Draw a dot for single clicks
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2)
    ctx.fill()
  }, [getPos, color, brushSize])

  const draw = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !lastPos.current) return
    e.preventDefault()
    e.stopPropagation()

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const pos = getPos(e)

    ctx.strokeStyle = color
    ctx.lineWidth = brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()

    lastPos.current = pos
  }, [isDrawing, getPos, color, brushSize])

  const stopDrawing = useCallback(() => {
    setIsDrawing(false)
    lastPos.current = null
  }, [])

  const handleClear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  const handleSave = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')
    onSave(dataUrl)
    handleClear()
  }

  if (!active) return null

  return (
    <>
      {/* Canvas overlay */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-10"
        style={{ cursor: 'crosshair' }}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
      />

      {/* Toolbar */}
      <div
        className="absolute top-3 left-3 z-20 flex items-center gap-2 p-2 rounded-lg"
        style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
      >
        <Pencil size={12} style={{ color: '#fff' }} />

        {/* Color picker */}
        {COLORS.map(c => (
          <button
            key={c.value}
            onClick={(e) => { e.stopPropagation(); setColor(c.value) }}
            className="w-5 h-5 rounded-full transition-transform"
            style={{
              background: c.value,
              border: color === c.value ? '2px solid #fff' : '2px solid transparent',
              transform: color === c.value ? 'scale(1.2)' : 'scale(1)',
            }}
            title={c.name}
          />
        ))}

        {/* Divider */}
        <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.2)' }} />

        {/* Brush size */}
        {BRUSH_SIZES.map(size => (
          <button
            key={size}
            onClick={(e) => { e.stopPropagation(); setBrushSize(size) }}
            className="flex items-center justify-center w-6 h-6 rounded transition-all"
            style={{
              background: brushSize === size ? 'rgba(255,255,255,0.2)' : 'transparent',
            }}
            title={`${size}px`}
          >
            <div
              className="rounded-full"
              style={{
                width: size + 2,
                height: size + 2,
                background: '#fff',
              }}
            />
          </button>
        ))}

        {/* Divider */}
        <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.2)' }} />

        {/* Clear */}
        <button
          onClick={(e) => { e.stopPropagation(); handleClear() }}
          className="p-1 rounded transition-colors"
          style={{ color: 'rgba(255,255,255,0.6)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.6)')}
          title="Clear canvas"
        >
          <Eraser size={14} />
        </button>

        {/* Save */}
        {hasDrawn && (
          <button
            onClick={(e) => { e.stopPropagation(); handleSave() }}
            className="px-2 py-1 rounded text-[10px] font-medium transition-colors"
            style={{ background: 'var(--gold)', color: '#000' }}
            title="Save annotation as note"
          >
            <Download size={12} />
          </button>
        )}

        {/* Close */}
        <button
          onClick={(e) => { e.stopPropagation(); onClose() }}
          className="p-1 rounded transition-colors"
          style={{ color: 'rgba(255,255,255,0.6)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.6)')}
          title="Exit annotation mode"
        >
          <X size={14} />
        </button>
      </div>

      {/* Mode indicator */}
      <div
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full text-[10px] font-medium"
        style={{ background: 'rgba(0,0,0,0.75)', color: 'var(--gold)' }}
      >
        Annotation Mode — Draw on screen, then save
      </div>
    </>
  )
}
