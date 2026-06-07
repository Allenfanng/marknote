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
    const url = window.prompt('Enter URL:')
    if (url) editor.insertLink(url)
  }

  const handleInsertImage = () => {
    if (!editor) return
    const url = window.prompt('Enter image URL:')
    if (url) editor.insertImage(url)
  }

  const dialogRef = useRef<HTMLDialogElement>(null)

  const openAbout = () => dialogRef.current?.showModal()
  const closeAbout = () => dialogRef.current?.close()

  return (
    <>
    <div className="toolbar">
      {/* Sidebar toggle */}
      <button
        className={`toolbar-btn ${sidebarOpen ? 'active' : ''}`}
        onClick={onToggleSidebar}
        data-tooltip="Toggle sidebar"
      >
        <PanelLeftOpen size={16} />
      </button>

      <div className="toolbar-divider" />

      {/* File group */}
      <button className="toolbar-btn" onClick={onNew} data-tooltip="New (Ctrl+N)">
        <FileText size={16} />
      </button>
      <button className="toolbar-btn" onClick={onOpen} data-tooltip="Open (Ctrl+O)">
        <FolderOpen size={16} />
      </button>
      <button className="toolbar-btn" onClick={onSave} data-tooltip="Save (Ctrl+S)">
        <Save size={16} />
      </button>

      <div className="toolbar-divider" />

      {/* Format group */}
      <button
        className={`toolbar-btn ${active.bold ? 'active' : ''}`}
        onClick={() => editor?.toggleBold()}
        disabled={fmtDisabled}
        data-tooltip="Bold (Ctrl+B)"
      >
        <Bold size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.italic ? 'active' : ''}`}
        onClick={() => editor?.toggleItalic()}
        disabled={fmtDisabled}
        data-tooltip="Italic (Ctrl+I)"
      >
        <Italic size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.strikethrough ? 'active' : ''}`}
        onClick={() => editor?.toggleStrikethrough()}
        disabled={fmtDisabled}
        data-tooltip="Strikethrough"
      >
        <Strikethrough size={16} />
      </button>

      <div className="toolbar-divider" />

      {/* Heading group */}
      <button
        className={`toolbar-btn ${active.heading === 1 ? 'active' : ''}`}
        onClick={() => editor?.setHeading(1)}
        disabled={fmtDisabled}
        data-tooltip="Heading 1"
      >
        <Heading1 size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.heading === 2 ? 'active' : ''}`}
        onClick={() => editor?.setHeading(2)}
        disabled={fmtDisabled}
        data-tooltip="Heading 2"
      >
        <Heading2 size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.heading === 3 ? 'active' : ''}`}
        onClick={() => editor?.setHeading(3)}
        disabled={fmtDisabled}
        data-tooltip="Heading 3"
      >
        <Heading3 size={16} />
      </button>

      <div className="toolbar-divider" />

      {/* Block group */}
      <button
        className={`toolbar-btn ${active.bulletList ? 'active' : ''}`}
        onClick={() => editor?.toggleBulletList()}
        disabled={fmtDisabled}
        data-tooltip="Bullet list"
      >
        <List size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.orderedList ? 'active' : ''}`}
        onClick={() => editor?.toggleOrderedList()}
        disabled={fmtDisabled}
        data-tooltip="Ordered list"
      >
        <ListOrdered size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.codeBlock ? 'active' : ''}`}
        onClick={() => editor?.insertCodeBlock()}
        disabled={fmtDisabled}
        data-tooltip="Code block"
      >
        <Code size={16} />
      </button>
      <button
        className={`toolbar-btn ${active.blockquote ? 'active' : ''}`}
        onClick={() => editor?.toggleBlockquote()}
        disabled={fmtDisabled}
        data-tooltip="Blockquote"
      >
        <Quote size={16} />
      </button>

      <div className="toolbar-divider" />

      {/* Insert group */}
      <button
        className="toolbar-btn"
        onClick={handleInsertLink}
        disabled={fmtDisabled}
        data-tooltip="Link"
      >
        <Link size={16} />
      </button>
      <button
        className="toolbar-btn"
        onClick={handleInsertImage}
        disabled={fmtDisabled}
        data-tooltip="Image"
      >
        <Image size={16} />
      </button>

      <div style={{ flex: 1 }} />

      {/* Export dropdown */}
      <div className="export-group" ref={exportMenuRef}>
        <button
          className="toolbar-btn"
          onClick={() => setExportMenuOpen((v) => !v)}
          data-tooltip="Export"
        >
          <Download size={16} />
        </button>
        {exportMenuOpen && (
          <div className="export-menu">
            <button className="export-menu-item" onClick={() => { onExportHtml(); setExportMenuOpen(false) }}>
              Export HTML
            </button>
            <button className="export-menu-item" onClick={() => { onExportPdf(); setExportMenuOpen(false) }}>
              Export PDF
            </button>
          </div>
        )}
      </div>

      <button
        className="toolbar-btn"
        onClick={openAbout}
        data-tooltip="About"
      >
        <Info size={16} />
      </button>
    </div>

    <dialog ref={dialogRef} className="about-dialog" onClick={(e) => { if (e.target === dialogRef.current) closeAbout() }}>
      <div className="about-content">
        <h2 className="about-title">MarkNote</h2>
        <p className="about-version">v1.2.4</p>
        <p className="about-author">作者：FZ</p>
        <p className="about-contact">联系邮箱：fung9108@163.com</p>
        <button className="about-close" onClick={closeAbout}>Close</button>
      </div>
    </dialog>
    </>
  )
}
