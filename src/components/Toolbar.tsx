import { useEffect, useState, useRef } from 'react'
import {
  FileText,
  FolderOpen,
  Save,
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Code,
  Quote,
  Link,
  Image,
  Table,
  Info,
  PanelLeftOpen,
  Download,
} from 'lucide-react'
import type { EditorHandle, ActiveState } from './Editor'

interface ToolbarProps {
  editor: EditorHandle | null
  disabled: boolean
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onExportHtml: () => void
  onExportPdf: () => void
}

const defaultActive: ActiveState = {
  bold: false,
  italic: false,
  strikethrough: false,
  heading: null,
  bulletList: false,
  orderedList: false,
  codeBlock: false,
  blockquote: false,
}

const TABLE_DIMENSION_MAX = 50

function clampDimension(value: number): number {
  if (!Number.isFinite(value)) return 3
  return Math.min(TABLE_DIMENSION_MAX, Math.max(1, Math.round(value)))
}

export default function Toolbar({
  editor,
  disabled,
  onNew,
  onOpen,
  onSave,
  sidebarOpen,
  onToggleSidebar,
  onExportHtml,
  onExportPdf,
}: ToolbarProps) {
  const [active, setActive] = useState<ActiveState>(defaultActive)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editor || disabled) return
    const id = setInterval(() => {
      try {
        setActive(editor.getActiveState())
      } catch {
        // editor may not be ready
      }
    }, 250)
    return () => clearInterval(id)
  }, [editor, disabled])

  // Close export menu on outside click
  useEffect(() => {
    if (!exportMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [exportMenuOpen])

  const fmtDisabled = disabled || !editor

  const handleInsertLink = () => {
    if (!editor) return
    const url = window.prompt('请输入链接地址：')
    if (url) editor.insertLink(url)
  }

  const handleInsertImage = () => {
    if (!editor) return
    const url = window.prompt('请输入图片地址：')
    if (url) editor.insertImage(url)
  }

  const dialogRef = useRef<HTMLDialogElement>(null)
  const tableDialogRef = useRef<HTMLDialogElement>(null)
  const [tableRows, setTableRows] = useState(3)
  const [tableCols, setTableCols] = useState(3)

  const openAbout = () => dialogRef.current?.showModal()
  const closeAbout = () => dialogRef.current?.close()

  const openTableDialog = () => {
    setTableRows(3)
    setTableCols(3)
    tableDialogRef.current?.showModal()
  }
  const closeTableDialog = () => tableDialogRef.current?.close()
  const confirmInsertTable = () => {
    const rows = clampDimension(tableRows)
    const cols = clampDimension(tableCols)
    editor?.insertTable(rows, cols)
    closeTableDialog()
  }

  return (
    <>
    <div className="toolbar">
      {/* Sidebar toggle */}
      <button
        className={`toolbar-btn ${sidebarOpen ? 'active' : ''}`}
        onClick={onToggleSidebar}
        data-tooltip="侧边栏"
      >
        <PanelLeftOpen size={16} />
      </button>

      <div className="toolbar-divider" />

      {/* File group */}
      <button className="toolbar-btn" onClick={onNew} data-tooltip="新建 (Ctrl+N)">
        <FileText size={16} />
      </button>
      <button className="toolbar-btn" onClick={onOpen} data-tooltip="打开 (Ctrl+O)">
        <FolderOpen size={16} />
      </button>
      <button className="toolbar-btn" onClick={onSave} data-tooltip="保存 (Ctrl+S)">
        <Save size={16} />
      </button>

      <div className="toolbar-divider" />

      {/* Format group */}
      <button
        className={`toolbar-btn ${active.bold ? 'active' : ''}`}
        onClick={() => editor?.toggleBold()}
        disabled={fmtDisabled}
        data-tooltip="加粗 (Ctrl+B)"
      >
        <Bold size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.italic ? 'active' : ''}`}
        onClick={() => editor?.toggleItalic()}
        disabled={fmtDisabled}
        data-tooltip="斜体 (Ctrl+I)"
      >
        <Italic size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.strikethrough ? 'active' : ''}`}
        onClick={() => editor?.toggleStrikethrough()}
        disabled={fmtDisabled}
        data-tooltip="删除线"
      >
        <Strikethrough size={16} />
      </button>

      <div className="toolbar-divider" />

      {/* Heading group */}
      <button
        className={`toolbar-btn ${active.heading === 1 ? 'active' : ''}`}
        onClick={() => editor?.setHeading(1)}
        disabled={fmtDisabled}
        data-tooltip="一级标题"
      >
        <Heading1 size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.heading === 2 ? 'active' : ''}`}
        onClick={() => editor?.setHeading(2)}
        disabled={fmtDisabled}
        data-tooltip="二级标题"
      >
        <Heading2 size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.heading === 3 ? 'active' : ''}`}
        onClick={() => editor?.setHeading(3)}
        disabled={fmtDisabled}
        data-tooltip="三级标题"
      >
        <Heading3 size={16} />
      </button>

      <div className="toolbar-divider" />

      {/* Block group */}
      <button
        className={`toolbar-btn ${active.bulletList ? 'active' : ''}`}
        onClick={() => editor?.toggleBulletList()}
        disabled={fmtDisabled}
        data-tooltip="无序列表"
      >
        <List size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.orderedList ? 'active' : ''}`}
        onClick={() => editor?.toggleOrderedList()}
        disabled={fmtDisabled}
        data-tooltip="有序列表"
      >
        <ListOrdered size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.codeBlock ? 'active' : ''}`}
        onClick={() => editor?.insertCodeBlock()}
        disabled={fmtDisabled}
        data-tooltip="代码块"
      >
        <Code size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.blockquote ? 'active' : ''}`}
        onClick={() => editor?.toggleBlockquote()}
        disabled={fmtDisabled}
        data-tooltip="引用块"
      >
        <Quote size={16} />
      </button>

      <div className="toolbar-divider" />

      {/* Insert group */}
      <button
        className="toolbar-btn"
        onClick={handleInsertLink}
        disabled={fmtDisabled}
        data-tooltip="链接"
      >
        <Link size={16} />
      </button>
      <button
        className="toolbar-btn"
        onClick={handleInsertImage}
        disabled={fmtDisabled}
        data-tooltip="图片"
      >
        <Image size={16} />
      </button>
      <button
        className="toolbar-btn"
        onClick={openTableDialog}
        disabled={fmtDisabled}
        data-tooltip="插入表格"
      >
        <Table size={16} />
      </button>

      <div style={{ flex: 1 }} />

      {/* Export dropdown */}
      <div className="export-group" ref={exportMenuRef}>
        <button
          className="toolbar-btn"
          onClick={() => setExportMenuOpen((v) => !v)}
          data-tooltip="导出"
        >
          <Download size={16} />
        </button>
        {exportMenuOpen && (
          <div className="export-menu">
            <button className="export-menu-item" onClick={() => { onExportHtml(); setExportMenuOpen(false) }}>
              导出 HTML
            </button>
            <button className="export-menu-item" onClick={() => { onExportPdf(); setExportMenuOpen(false) }}>
              导出 PDF
            </button>
          </div>
        )}
      </div>

      <button
        className="toolbar-btn"
        onClick={openAbout}
        data-tooltip="关于"
      >
        <Info size={16} />
      </button>
    </div>

    <dialog ref={dialogRef} className="about-dialog" onClick={(e) => { if (e.target === dialogRef.current) closeAbout() }}>
      <div className="about-content">
        <h2 className="about-title">MarkNote</h2>
        <p className="about-version">v1.5.0</p>
        <p className="about-author">作者：FZ</p>
        <p className="about-contact">联系邮箱：fung9108@163.com</p>
        <button className="about-close" onClick={closeAbout}>关闭</button>
      </div>
    </dialog>

    <dialog
      ref={tableDialogRef}
      className="table-dialog"
      onClick={(e) => { if (e.target === tableDialogRef.current) closeTableDialog() }}
    >
      <div className="table-dialog-content">
        <h3 className="table-dialog-title">插入表格</h3>
        <div className="table-dialog-fields">
          <label className="table-dialog-field">
            行数
            <input
              type="number"
              min={1}
              max={TABLE_DIMENSION_MAX}
              value={tableRows}
              onChange={(e) => setTableRows(Number(e.target.value))}
            />
          </label>
          <span className="table-dialog-times">×</span>
          <label className="table-dialog-field">
            列数
            <input
              type="number"
              min={1}
              max={TABLE_DIMENSION_MAX}
              value={tableCols}
              onChange={(e) => setTableCols(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="table-dialog-actions">
          <button className="table-dialog-btn" onClick={closeTableDialog}>取消</button>
          <button className="table-dialog-btn primary" onClick={confirmInsertTable}>插入</button>
        </div>
      </div>
    </dialog>
    </>
  )
}
