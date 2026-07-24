import { useState, useEffect, useRef } from 'react'
import { Moon, Sun, Code2, Plus, X, FolderOpen, Copy, XCircle } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'

export interface Tab {
  id: string
  filePath: string | null
  content: string
  sourceContent: string
  isDirty: boolean
  viewMode: 'wysiwyg' | 'source'
}

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string
  onTabClick: (id: string) => void
  onTabClose: (id: string) => void
  onNewTab: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  viewMode: 'wysiwyg' | 'source'
  onToggleViewMode: () => void
}

interface ContextMenuState {
  x: number
  y: number
  tab: Tab
}

export default function TabBar({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab,
  theme,
  onToggleTheme,
  viewMode,
  onToggleViewMode,
}: TabBarProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close()
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  const handleContextMenu = (e: React.MouseEvent, tab: Tab) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, tab })
  }

  const handleOpenFolder = async (tab: Tab) => {
    setContextMenu(null)
    if (!tab.filePath) return
    try {
      await invoke('open_in_folder', { path: tab.filePath })
    } catch (err) {
      alert('打开所在文件夹失败：' + err)
    }
  }

  const handleCopyPath = async (tab: Tab) => {
    setContextMenu(null)
    if (!tab.filePath) return
    try {
      await navigator.clipboard.writeText(tab.filePath)
    } catch {
      // clipboard may be unavailable; fallback ignored
    }
  }

  const handleCloseFromMenu = (tab: Tab) => {
    setContextMenu(null)
    onTabClose(tab.id)
  }

  return (
    <div className="tab-bar">
      <div
        className="tab-bar-tabs"
        onWheel={(e) => {
          e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        {tabs.map((tab) => {
          const fileName = tab.filePath
            ? tab.filePath.split(/[\\/]/).pop()
            : 'Untitled'
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              className={`tab-item ${isActive ? 'active' : ''}`}
              onClick={() => onTabClick(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab)}
              title={tab.filePath ?? 'Untitled'}
            >
              <span className="tab-name">{fileName}</span>
              {tab.isDirty && <span className="tab-dirty-dot" />}
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onTabClose(tab.id)
                }}
                title="Close"
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
        <button className="tab-new" onClick={onNewTab} title="New tab (Ctrl+N)">
          <Plus size={14} />
        </button>
      </div>
      <div className="tab-bar-actions">
        <button
          className={`titlebar-btn ${viewMode === 'source' ? 'active' : ''}`}
          onClick={onToggleViewMode}
          title="Source code (Ctrl+/)"
        >
          <Code2 size={16} />
        </button>
        <button
          className="titlebar-btn"
          onClick={onToggleTheme}
          title="Toggle theme"
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="tab-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="context-menu-item"
            onClick={() => handleOpenFolder(contextMenu.tab)}
            disabled={!contextMenu.tab.filePath}
            title={contextMenu.tab.filePath ? '在资源管理器中显示' : '尚未保存到磁盘'}
          >
            <FolderOpen size={14} />
            <span>打开所在文件夹</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => handleCopyPath(contextMenu.tab)}
            disabled={!contextMenu.tab.filePath}
          >
            <Copy size={14} />
            <span>复制文件路径</span>
          </button>
          <div className="context-menu-divider" />
          <button
            className="context-menu-item"
            onClick={() => handleCloseFromMenu(contextMenu.tab)}
          >
            <XCircle size={14} />
            <span>关闭标签页</span>
          </button>
        </div>
      )}
    </div>
  )
}
