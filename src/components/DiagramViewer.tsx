import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X, ZoomIn, ZoomOut, Maximize2, Download, Move } from 'lucide-react'
import { exportSvgFile } from '../lib/diagramActions'

/**
 * 图表全屏查看器。
 *
 * 编辑器里的图受正文栏宽度限制，宽图（时序图/架构图）会被压得很小、字看不清；
 * 这个浮层把图放大到整个窗口，支持滚轮/按钮缩放、拖拽平移，并可直接导出 SVG。
 */

interface DiagramViewerProps {
  /** 完整 SVG 源码（来自 serializeSvg，已带固定宽高） */
  svg: string
  title: string
  onClose: () => void
}

const MIN_SCALE = 0.1
const MAX_SCALE = 8
const STAGE_PADDING = 40

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

function readNaturalSize(el: SVGSVGElement, currentScale: number): { w: number; h: number } {
  const w = parseFloat(el.getAttribute('width') ?? '')
  const h = parseFloat(el.getAttribute('height') ?? '')
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) return { w, h }

  const viewBox = (el.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if (viewBox.length === 4 && Number.isFinite(viewBox[2]) && Number.isFinite(viewBox[3])) {
    return { w: viewBox[2], h: viewBox[3] }
  }

  // 兜底：按当前缩放还原渲染尺寸
  const rect = el.getBoundingClientRect()
  const safeScale = currentScale > 0 ? currentScale : 1
  return { w: rect.width / safeScale, h: rect.height / safeScale }
}

export default function DiagramViewer({ svg, title, onClose }: DiagramViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 })

  // 量原始尺寸：缩放由 CSS transform 完成，不改 SVG 元素本身
  useLayoutEffect(() => {
    const el = holderRef.current?.querySelector('svg')
    if (!(el instanceof SVGSVGElement)) return
    setNatural(readNaturalSize(el, scale))
    // 只在内容变化时量一次；scale 变化不参与，避免循环更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg])

  const fitToStage = useCallback(() => {
    const stage = stageRef.current
    if (!stage || !natural.w || !natural.h) return
    const s = Math.min(
      (stage.clientWidth - STAGE_PADDING) / natural.w,
      (stage.clientHeight - STAGE_PADDING) / natural.h,
    )
    setScale(clampScale(s))
    setOffset({ x: 0, y: 0 })
  }, [natural])

  // 首次量到尺寸后自动适应窗口
  const fittedRef = useRef(false)
  useEffect(() => {
    if (fittedRef.current || !natural.w) return
    fittedRef.current = true
    fitToStage()
  }, [natural, fitToStage])

  useEffect(() => {
    const onResize = () => fitToStage()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fitToStage])

  // ESC 关闭；+/- 缩放；0 适应窗口；1 原始大小
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === '+' || e.key === '=') {
        setScale((s) => clampScale(s * 1.25))
      } else if (e.key === '-' || e.key === '_') {
        setScale((s) => clampScale(s / 1.25))
      } else if (e.key === '0') {
        fitToStage()
      } else if (e.key === '1') {
        setScale(1)
        setOffset({ x: 0, y: 0 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, fitToStage])

  // 滚轮缩放
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      setScale((s) => clampScale(s * factor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.x),
      y: dragStart.current.oy + (e.clientY - dragStart.current.y),
    })
  }
  const endDrag = (e: React.PointerEvent) => {
    if (!dragging) return
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const handleExport = async () => {
    const el = holderRef.current?.querySelector('svg')
    if (!(el instanceof SVGSVGElement)) return
    try {
      await exportSvgFile(el, `diagram-${Date.now()}.svg`)
    } catch (err) {
      console.error('导出 SVG 失败', err)
    }
  }

  const percent = Math.round(scale * 100)

  return (
    <div className="diagram-viewer" role="dialog" aria-modal="true" aria-label={`${title} 全屏查看`}>
      <div className="diagram-viewer-header">
        <span className="diagram-viewer-title">{title}</span>
        <div className="diagram-viewer-tools">
          <button className="dv-btn" onClick={() => setScale((s) => clampScale(s / 1.25))} title="缩小 (-)">
            <ZoomOut size={16} />
          </button>
          <span className="dv-scale">{percent}%</span>
          <button className="dv-btn" onClick={() => setScale((s) => clampScale(s * 1.25))} title="放大 (+)">
            <ZoomIn size={16} />
          </button>
          <div className="dv-divider" />
          <button className="dv-btn" onClick={fitToStage} title="适应窗口 (0)">
            <Maximize2 size={16} />
            <span className="dv-btn-text">适应</span>
          </button>
          <button
            className="dv-btn"
            onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }}
            title="原始大小 (1)"
          >
            <span className="dv-btn-text">1:1</span>
          </button>
          <div className="dv-divider" />
          <button className="dv-btn" onClick={handleExport} title="导出为 SVG 文件">
            <Download size={16} />
            <span className="dv-btn-text">导出 SVG</span>
          </button>
          <div className="dv-divider" />
          <button className="dv-btn dv-close" onClick={onClose} title="关闭 (Esc)">
            <X size={16} />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={`diagram-viewer-stage ${dragging ? 'dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <div
          ref={holderRef}
          className="diagram-viewer-canvas"
          style={{
            transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="diagram-viewer-hint">
          <Move size={12} /> 拖拽平移 · 滚轮缩放 · Esc 关闭
        </div>
      </div>
    </div>
  )
}
