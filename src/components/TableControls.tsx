import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Grid2x2, Rows3, Columns2, Trash2 } from 'lucide-react'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EditorHandle, TableOp } from './Editor'

/**
 * 表格边缘控件：鼠标靠近表格时，在右边缘 / 下边缘浮出"+"按钮，
 * 点一下就能加行加列；左上角的手柄打开完整菜单（上下插入、删除行列、删表）。
 *
 * 控件是覆盖在编辑器上的一层 DOM，不进 ProseMirror 文档，靠
 * view.nodeDOM 把 DOM 表格映射回文档里的表格节点位置。
 */

const EDGE_TOLERANCE = 30 // 鼠标离表格多远仍算"贴着边缘"
const BUTTON_SIZE = 18

interface HoverState {
  tablePos: number
  left: number
  top: number
  width: number
  height: number
  rowTop: number
  rowHeight: number
  colLeft: number
  colWidth: number
  rowIndex: number
  colIndex: number
}

interface TableControlsProps {
  containerRef: React.RefObject<HTMLElement | null>
  editor: EditorHandle | null
  enabled: boolean
}

function findTablePos(view: EditorView, tableEl: HTMLElement): number | null {
  let found: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type.name !== 'table') return true
    const dom = view.nodeDOM(pos)
    if (dom instanceof HTMLElement && (dom === tableEl || dom.contains(tableEl))) {
      found = pos
      return false
    }
    return true
  })
  return found
}

/** 用所有单元格的左边界切出列区间——rowspan / colspan 混用时也比按 cells 下标猜稳。 */
function columnEdges(table: HTMLTableElement): number[] {
  const lefts = new Set<number>()
  for (const row of Array.from(table.rows)) {
    for (const cell of Array.from(row.cells)) {
      lefts.add(Math.round(cell.getBoundingClientRect().left))
    }
  }
  const raw = Array.from(lefts).sort((a, b) => a - b)
  // 亚像素差异会切出假列，2px 以内合并成同一条边
  const edges: number[] = []
  for (const v of raw) {
    if (edges.length === 0 || v - edges[edges.length - 1] > 2) edges.push(v)
  }
  return edges
}

/** 逐字段比较，避免鼠标每动一帧就重渲染一次覆盖层 */
function sameHover(a: HoverState | null, b: HoverState | null): boolean {
  if (!a || !b) return a === b
  return (Object.keys(a) as (keyof HoverState)[]).every((key) => a[key] === b[key])
}

export default function TableControls({ containerRef, editor, enabled }: TableControlsProps) {
  const [hover, setHover] = useState<HoverState | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const pointerRef = useRef({ x: 0, y: 0 })
  const hoverRef = useRef<HoverState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // editor 每次渲染都是新对象引用，用 ref 兜住，避免 mousemove 监听反复重挂
  const editorRef = useRef(editor)
  editorRef.current = editor

  const clearHover = useCallback(() => {
    hoverRef.current = null
    setHover(null)
    setMenuOpen(false)
  }, [])

  const update = useCallback(() => {
    const container = containerRef.current
    const current = editorRef.current
    const view = current?.getView()
    if (!container || !view || !current?.ready) {
      clearHover()
      return
    }

    const { x, y } = pointerRef.current
    // 排除 Crepe 表格块自带的 drag-preview 模板表（隐藏的空 <table>）
    const tables = (
      Array.from(container.querySelectorAll('table')) as HTMLTableElement[]
    ).filter((t) => t.closest('.drag-preview') === null)
    if (tables.length === 0) {
      clearHover()
      return
    }

    // 选出离鼠标最近的表格（允许 EDGE_TOLERANCE 的外扩命中，这样"+"
    // 按钮本身位于表格外面时也不会立刻消失）
    let target: HTMLTableElement | null = null
    let bestDistance = Infinity
    for (const table of tables) {
      const r = table.getBoundingClientRect()
      if (
        x < r.left - EDGE_TOLERANCE ||
        x > r.right + EDGE_TOLERANCE ||
        y < r.top - EDGE_TOLERANCE ||
        y > r.bottom + EDGE_TOLERANCE
      ) {
        continue
      }
      const dx = Math.max(r.left - x, 0, x - r.right)
      const dy = Math.max(r.top - y, 0, y - r.bottom)
      const distance = Math.hypot(dx, dy)
      if (distance < bestDistance) {
        bestDistance = distance
        target = table
      }
    }

    if (!target) {
      clearHover()
      return
    }

    const tablePos = findTablePos(view, target)
    if (tablePos === null) {
      clearHover()
      return
    }

    const rect = target.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const originX = containerRect.left - container.scrollLeft
    const originY = containerRect.top - container.scrollTop
    const left = rect.left - originX
    const top = rect.top - originY

    const rows = Array.from(target.rows)
    const edges = columnEdges(target)
    const insideTable = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    // 指针移出表格外（去点边缘按钮 / 手柄）时，沿用最后悬停的行列，
    // 否则一碰手柄就会跳回第一行，菜单操作的目标就错了
    const keepFromPrev = !insideTable && hoverRef.current?.tablePos === tablePos

    // 命中行
    let rowIndex: number
    let rowTop: number
    let rowHeight: number
    if (keepFromPrev) {
      rowIndex = hoverRef.current!.rowIndex
    } else {
      rowIndex = rows.length - 1
      for (let i = 0; i < rows.length; i++) {
        const rr = rows[i].getBoundingClientRect()
        if (y < rr.bottom || i === rows.length - 1) {
          rowIndex = i
          break
        }
      }
    }
    const rowRect = rows[Math.min(rowIndex, rows.length - 1)]?.getBoundingClientRect()
    rowTop = (rowRect?.top ?? rect.top) - originY
    rowHeight = rowRect?.height ?? rect.height

    // 命中列
    let colIndex: number
    let colLeft: number
    let colWidth: number
    if (keepFromPrev) {
      colIndex = hoverRef.current!.colIndex
    } else {
      colIndex = edges.length - 1
      for (let i = 0; i < edges.length; i++) {
        if (x < edges[i]) {
          colIndex = Math.max(0, i - 1)
          break
        }
      }
    }
    const colStart = edges[Math.min(colIndex, edges.length - 1)] ?? rect.left
    const colEnd = edges[colIndex + 1] ?? rect.right
    colLeft = colStart - originX
    colWidth = Math.max(colEnd - colStart, 12)

    const next: HoverState = {
      tablePos,
      left,
      top,
      width: rect.width,
      height: rect.height,
      rowTop,
      rowHeight,
      colLeft,
      colWidth,
      rowIndex,
      colIndex,
    }
    if (sameHover(hoverRef.current, next)) return
    hoverRef.current = next
    setHover(next)
  }, [containerRef, clearHover])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !enabled) {
      clearHover()
      return
    }

    let raf = 0
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        update()
      })
    }
    const onMove = (e: MouseEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY }
      schedule()
    }
    const onLeave = () => clearHover()

    container.addEventListener('mousemove', onMove)
    container.addEventListener('mouseleave', onLeave)
    container.addEventListener('scroll', onLeave)
    window.addEventListener('resize', onLeave)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseleave', onLeave)
      container.removeEventListener('scroll', onLeave)
      window.removeEventListener('resize', onLeave)
    }
  }, [containerRef, enabled, update, clearHover])

  // 菜单点外面就关掉
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const run = useCallback(
    (op: TableOp, index: number) => {
      if (!hover) return
      editor?.runTableOp(op, index, hover.tablePos)
      setMenuOpen(false)
      // 表格尺寸变了，等一帧再按当前鼠标位置重算
      requestAnimationFrame(() => requestAnimationFrame(update))
    },
    [hover, editor, update]
  )

  if (!hover) return null

  return (
    <div className="table-overlay">
      <button
        className={`table-grip ${menuOpen ? 'active' : ''}`}
        style={{ left: hover.left - BUTTON_SIZE - 4, top: hover.top }}
        title="表格选项"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <Grid2x2 size={12} />
      </button>

      <button
        className="table-edge-btn table-edge-row"
        style={{
          left: hover.left + hover.width + 4,
          top: hover.rowTop + hover.rowHeight / 2 - BUTTON_SIZE / 2,
        }}
        title="在下方插入行"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => run('addRowAfter', hover.rowIndex)}
      >
        <Plus size={12} />
      </button>

      <button
        className="table-edge-btn table-edge-col"
        style={{
          left: hover.colLeft + hover.colWidth / 2 - BUTTON_SIZE / 2,
          top: hover.top + hover.height + 4,
        }}
        title="在右侧插入列"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => run('addColAfter', hover.colIndex)}
      >
        <Plus size={12} />
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          className="table-menu"
          style={{
            left: hover.left - BUTTON_SIZE - 4,
            top: hover.top + 4,
          }}
        >
          <div className="table-menu-label">
            <Rows3 size={12} />
            <span>行 {hover.rowIndex + 1}{hover.rowIndex === 0 ? '（表头）' : ''}</span>
          </div>
          <button className="table-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => run('addRowBefore', hover.rowIndex)}>
            在上方插入行
          </button>
          <button className="table-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => run('addRowAfter', hover.rowIndex)}>
            在下方插入行
          </button>
          <button
            className="table-menu-item danger"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run('deleteRow', hover.rowIndex)}
            disabled={hover.rowIndex === 0}
            title={hover.rowIndex === 0 ? '表头行不可删除' : undefined}
          >
            <Trash2 size={12} />
            删除本行
          </button>

          <div className="table-menu-divider" />

          <div className="table-menu-label">
            <Columns2 size={12} />
            <span>列 {hover.colIndex + 1}</span>
          </div>
          <button className="table-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => run('addColBefore', hover.colIndex)}>
            在左侧插入列
          </button>
          <button className="table-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => run('addColAfter', hover.colIndex)}>
            在右侧插入列
          </button>
          <button className="table-menu-item danger" onMouseDown={(e) => e.preventDefault()} onClick={() => run('deleteCol', hover.colIndex)}>
            <Trash2 size={12} />
            删除本列
          </button>

          <div className="table-menu-divider" />

          <button className="table-menu-item danger" onMouseDown={(e) => e.preventDefault()} onClick={() => run('deleteTable', 0)}>
            <Trash2 size={12} />
            删除表格
          </button>
        </div>
      )}
    </div>
  )
}
