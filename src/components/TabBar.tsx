import { Moon, Sun, Code2, Plus, X } from 'lucide-react'

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
    </div>
  )
}
