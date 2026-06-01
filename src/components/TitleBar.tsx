import { Moon, Sun, Code2 } from 'lucide-react'

interface TitleBarProps {
  filePath: string | null
  isDirty: boolean
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  viewMode: 'wysiwyg' | 'source'
  onToggleViewMode: () => void
}

export default function TitleBar({
  filePath,
  isDirty,
  theme,
  onToggleTheme,
  viewMode,
  onToggleViewMode,
}: TitleBarProps) {
  const fileName = filePath
    ? filePath.split(/[\\/]/).pop()
    : 'Untitled'

  return (
    <div className="titlebar">
      <div className="titlebar-title">
        MarkNote — {fileName}
        {isDirty && <span className="dirty-dot" />}
      </div>
      <div className="titlebar-actions">
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
